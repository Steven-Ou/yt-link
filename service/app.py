import os
import sys
import logging
import json
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from rq import Queue
from rq.job import Job
from redis import Redis
import yt_dlp
import static_ffmpeg # Import the new package

# Add ffmpeg to the PATH
static_ffmpeg.add_paths()

# --- Basic Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
CORS(app)

# Redis and RQ setup
redis_conn = Redis()
q = Queue(connection=redis_conn)

# Define the single, consistent directory for downloads
DOWNLOADS_DIR = os.path.join(os.path.expanduser('~'), 'yt-link-downloads')
if not os.path.exists(DOWNLOADS_DIR):
    os.makedirs(DOWNLOADS_DIR)
    logging.info(f"Created downloads directory at: {DOWNLOADS_DIR}")

# --- Helper Functions ---
def get_job_status_dict(job):
    """Creates a dictionary with the job's current status and result."""
    status = job.get_status()
    result = job.result
    # Default message if no specific message is in the result
    message = f"Job status: {status}"
    progress = 0
    file_path = None
    file_name = None

    if status == 'failed':
        # If the job failed, the result contains the error message.
        message = str(result) or "Job failed with no error message."
    elif isinstance(result, dict):
        # If the job is running, the result is a dictionary with details.
        message = result.get('message', message)
        progress = result.get('progress', 0)
        file_path = result.get('file_path')
        file_name = result.get('file_name')

    return {
        'jobId': job.id,
        'status': status,
        'progress': progress,
        'message': message,
        'filePath': file_path,
        'fileName': file_name
    }

def progress_hook(d, job_id):
    """A hook for yt-dlp to report progress back to the Redis job."""
    if d['status'] == 'downloading':
        # Extract progress percentage
        progress_str = d['_percent_str'].replace('%', '').strip()
        try:
            progress = float(progress_str)
            job = Job.fetch(job_id, connection=redis_conn)
            job.meta['progress'] = progress
            job.meta['message'] = f"Downloading: {d['filename']}"
            job.save_meta()
        except (ValueError, TypeError):
            pass # Ignore if progress string is not a valid float

# --- Download Task (The actual work done by the worker) ---
def download_video(job_type, url, download_path, cookies_path=None):
    """
    Main task function for downloading and processing YouTube videos/playlists.
    """
    job = Job.fetch(request.json['jobId'], connection=redis_conn)
    job.meta['message'] = 'Preparing download...'
    job.save_meta()

    ydl_opts = {
        'cookiefile': cookies_path,
        'progress_hooks': [lambda d: progress_hook(d, job.id)],
        'nocheckcertificate': True,
        'ignoreerrors': True,
        'outtmpl': os.path.join(download_path, '%(title)s.%(ext)s'),
    }

    if job_type == 'single_mp3':
        ydl_opts.update({
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
    elif job_type == 'playlist_zip':
        ydl_opts.update({
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
             'outtmpl': os.path.join(download_path, '%(playlist_title)s', '%(playlist_index)s - %(title)s.%(ext)s'),
        })
        # This option is no longer needed as we'll handle zipping separately if required
        # 'postprocessors': [{'key': 'FFmpegVideoConvertor', 'preferedformat': 'mp4'}],
    elif job_type == 'combine_playlist_mp3':
         ydl_opts.update({
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(download_path, '%(playlist_title)s', '%(title)s.%(ext)s'),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'postprocessor_args': {
                'extractaudio': ['-ac', '2'] # Ensure stereo audio
            }
        })
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            job.meta['message'] = 'Starting download and processing...'
            job.save_meta()
            
            info = ydl.extract_info(url, download=True)
            
            # After download, determine the output file path for the API response
            # Note: This is a simplified approach. For playlists, the path would be to the folder.
            output_filename = ydl.prepare_filename(info).rsplit('.', 1)[0] + '.mp3' # Guessing for mp3
            relative_path = os.path.relpath(output_filename, DOWNLOADS_DIR)

            job.meta['message'] = 'Download and conversion complete.'
            job.meta['progress'] = 100
            # We store a URL-encoded, platform-independent path
            job.meta['file_path'] = f"/downloads/{relative_path.replace(os.path.sep, '/')}"
            job.meta['file_name'] = os.path.basename(relative_path)
            job.save_meta()

            return {
                'message': 'Job completed successfully.',
                'file_path': job.meta['file_path'],
                'file_name': job.meta['file_name']
            }
            
    except Exception as e:
        logging.error(f"Error in yt-dlp for job {job.id}: {e}", exc_info=True)
        # Propagate the error message to the job result
        raise e


# --- API Routes ---
@app.route('/start-job', methods=['POST'])
def start_job():
    """Starts a new download job."""
    data = request.get_json()
    job_type = data.get('jobType')
    url = data.get('youtubeUrl')

    if not job_type or not url:
        return jsonify({'error': 'Missing jobType or youtubeUrl'}), 400

    # Create a unique directory for this job inside the main downloads directory
    # This prevents filename collisions and keeps downloads organized.
    job_dir_name = yt_dlp.utils.sanitize_filename(f"{job_type}_{os.urandom(4).hex()}")
    job_download_path = os.path.join(DOWNLOADS_DIR, job_dir_name)
    os.makedirs(job_download_path, exist_ok=True)
    
    # Enqueue the job
    job = q.enqueue(
        'app.download_video',
        job_type=job_type,
        url=url,
        download_path=job_download_path,
        cookies_path=data.get('cookiesPath'),
        job_timeout='2h'
    )
    
    logging.info(f"Started job {job.id} of type {job_type} for URL: {url}")
    return jsonify({'jobId': job.id}), 202

@app.route('/job-status', methods=['GET'])
def job_status():
    """Gets the status of a job."""
    job_id = request.args.get('jobId')
    if not job_id:
        return jsonify({'error': 'Missing jobId parameter'}), 400
    
    try:
        job = Job.fetch(job_id, connection=redis_conn)
        return jsonify(get_job_status_dict(job)), 200
    except Exception as e:
        logging.error(f"Error fetching job {job_id}: {e}")
        return jsonify({'status': 'failed', 'message': 'Could not retrieve job from queue.'}), 404

@app.route('/downloads/<path:filename>')
def serve_download(filename):
    """Serves a downloaded file."""
    logging.info(f"Attempting to serve file: {filename} from directory: {DOWNLOADS_DIR}")
    # The 'filename' here is the relative path from the downloads dir
    return send_from_directory(DOWNLOADS_DIR, filename, as_attachment=True)


if __name__ == '__main__':
    # Get port from command line arguments or default to 5001
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    app.run(host='127.0.0.1', port=port, debug=True)
