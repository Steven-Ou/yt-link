import os
import sys
import logging
import json
import zipfile
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from rq import Queue, Job, get_current_job # Import get_current_job
from redis import Redis
import yt_dlp
import static_ffmpeg # Solves the ffmpeg/ffprobe not found issue

# --- Basic Setup ---

# Add the bundled ffmpeg to the system's PATH
static_ffmpeg.add_paths()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
CORS(app)

# Redis and RQ (task queue) setup
redis_conn = Redis(decode_responses=True)
q = Queue(connection=redis_conn)

# --- Helper Functions ---
def get_job_status_dict(job):
    """Creates a standardized dictionary with the job's current status and result."""
    status = job.get_status()
    meta = job.get_meta()
    
    # Provide defaults
    message = f"Job status: {status}"
    progress = 0
    download_path = None
    
    if status == 'failed':
        message = str(job.exc_info) or "Job failed with no error message."
    elif meta:
        # If the job is running or completed, get details from the job's meta dictionary
        message = meta.get('message', message)
        progress = meta.get('progress', 0)
        download_path = meta.get('download_path')

    return {
        'id': job.id,
        'status': status,
        'progress': progress,
        'message': message,
        'downloadPath': download_path # Pass back the path for the "Open Folder" button
    }

def progress_hook(d, job):
    """A hook for yt-dlp to report progress back to the Redis job's metadata."""
    if d['status'] == 'downloading':
        try:
            progress = d.get('_percent_str', '0%').replace('%', '').strip()
            job.meta['progress'] = float(progress)
            job.meta['message'] = f"Downloading: {d.get('filename', '...')}"
            job.save_meta()
        except (ValueError, TypeError):
            pass # Ignore if progress string is not a valid float
    elif d['status'] == 'finished':
        job.meta['progress'] = 100
        job.meta['message'] = "Download finished, post-processing..."
        job.save_meta()
    elif d['status'] == 'error':
        job.meta['message'] = "An error occurred during download."
        job.save_meta()


# --- Download Task (The actual work done by the RQ worker) ---
def download_task(job_type, url, download_path, cookies_path=None):
    """
    Main task function for downloading and processing YouTube videos/playlists.
    This function runs in the background on a worker.
    """
    # FIX: Use get_current_job() to correctly get the job instance within a worker.
    # This replaces the old code that incorrectly tried to access the Flask `request`.
    job = get_current_job()
    job.meta['message'] = 'Preparing download...'
    job.save_meta()

    ydl_opts = {
        'cookiefile': cookies_path,
        'progress_hooks': [lambda d: progress_hook(d, job)],
        'nocheckcertificate': True,
        'ignoreerrors': True,
        'outtmpl': os.path.join(download_path, '%(title)s.%(ext)s'),
    }

    if job_type == 'single_mp3':
        ydl_opts.update({
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192',
            }],
        })
    elif job_type == 'playlist_zip':
        ydl_opts.update({
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl': os.path.join(download_path, '%(playlist_index)s - %(title)s.%(ext)s'),
        })
    elif job_type == 'combine_mp3':
        ydl_opts.update({
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(download_path, '%(title)s.%(ext)s'),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192',
            }],
        })

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            job.meta['message'] = 'Starting download and processing...'
            job.save_meta()
            ydl.download([url])
        
        # Post-processing for zip files
        if job_type == 'playlist_zip':
            job.meta['message'] = 'Zipping playlist files...'
            job.save_meta()
            zip_path = f"{download_path}.zip"
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, _, files in os.walk(download_path):
                    for file in files:
                        zipf.write(os.path.join(root, file), arcname=file)
            job.meta['download_path'] = os.path.dirname(zip_path) # Path to the folder containing the zip
        else:
            job.meta['download_path'] = download_path

        job.meta['message'] = 'Job completed successfully!'
        job.meta['progress'] = 100
        job.save_meta()

    except Exception as e:
        logging.error(f"Error in download_task for job {job.id}: {e}", exc_info=True)
        # Propagate the error message to the job result by raising it
        raise e

# --- API Route Definitions ---

def start_job_handler(job_type):
    """A generic handler to validate the request and enqueue a job."""
    data = request.get_json()
    url = data.get('youtubeUrl') or data.get('url') # Accept 'url' for legacy compatibility
    download_path = data.get('downloadPath')
    cookies_path = data.get('cookiesPath')

    if not url or not download_path:
        return jsonify({'error': 'Missing URL or downloadPath in request body'}), 400

    try:
        # Enqueue the actual work to be done by the worker
        job = q.enqueue(download_task, args=(job_type, url, download_path, cookies_path), job_timeout='2h')
        # Immediately save the download path to the job's metadata
        job.meta['download_path'] = download_path
        job.save_meta()

        logging.info(f"Enqueued job {job.id} of type {job_type} for URL: {url}")
        return jsonify({'jobId': job.id}), 202 # 202 Accepted
    except Exception as e:
        logging.error(f"Failed to enqueue job: {e}", exc_info=True)
        return jsonify({'error': 'Failed to enqueue job'}), 500


# FIX: Define the specific routes that the Electron frontend is calling
@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job_route():
    return start_job_handler('single_mp3')

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job_route():
    return start_job_handler('playlist_zip')

@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job_route():
    return start_job_handler('combine_mp3')


@app.route('/job-status', methods=['GET'])
def job_status_route():
    """Gets the status of a job."""
    job_id = request.args.get('jobId')
    if not job_id:
        return jsonify({'error': 'Missing jobId parameter'}), 400
    
    try:
        job = Job.fetch(job_id, connection=redis_conn)
        return jsonify(get_job_status_dict(job)), 200
    except Exception:
        # This can happen if the job ID is invalid or expired
        return jsonify({'status': 'not_found', 'message': f'Job {job_id} not found.'}), 404

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    app.run(host='127.0.0.1', port=port, debug=False)
