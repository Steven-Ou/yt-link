import sys
import os
import json
import logging
import shutil
import tempfile
import zipfile
from flask import Flask, request, jsonify, send_from_directory
from yt_dlp import YoutubeDL
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

# --- Basic Setup ---
app = Flask(__name__)

# Configure logging to a file
log_dir = os.path.join(os.path.expanduser("~"), ".yt-link-logs")
os.makedirs(log_dir, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(log_dir, "backend.log")),
        logging.StreamHandler(sys.stdout)  # Also log to console
    ]
)

# --- Global State ---
# Using a dictionary to manage job statuses and results
jobs = {}
jobs_lock = Lock()
executor = ThreadPoolExecutor(max_workers=4)


# --- Core Functions ---

def find_executable(name):
    """Finds an executable, accounting for being bundled for production."""
    if getattr(sys, 'frozen', False):
        # When packaged, the backend executable is in `Resources/backend`.
        # The other executables will be in `Resources/bin`.
        base_path = os.path.dirname(sys.executable)
        bin_path = os.path.join(base_path, '..', 'bin')
        exe_name = f"{name}.exe" if sys.platform == "win32" else name
        exe_path = os.path.join(bin_path, exe_name)
        if os.path.exists(exe_path):
            logging.info(f"Found bundled executable '{name}' at: {exe_path}")
            return exe_path
        logging.error(f"Could not find bundled '{name}' at expected path: {exe_path}")
        return None
    
    # In development, find the executable in the system's PATH.
    fallback_path = shutil.which(name)
    if fallback_path:
        logging.info(f"Found executable '{name}' in system PATH: {fallback_path}")
    return fallback_path


def get_ydl_options(output_path, playlist=False):
    """Gets the base options for yt-dlp."""
    ffmpeg_location = find_executable('ffmpeg')
    yt_dlp_location = find_executable('yt-dlp')

    if not ffmpeg_location:
        logging.error("FFmpeg executable not found!")
    if not yt_dlp_location:
        logging.error("yt-dlp executable not found!")

    return {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'outtmpl': os.path.join(output_path, '%(title)s.%(ext)s'),
        'noplaylist': not playlist,
        'ffmpeg_location': ffmpeg_location,
        'yt-dlp_path': yt_dlp_location,
        'quiet': True,
        'progress_hooks': [], # Placeholder for progress hooks
        'nocheckcertificate': True,
    }

def update_job_status(job_id, status, message=None, result_path=None, total_videos=0, completed_videos=0, current_video_title=""):
    """Thread-safe way to update a job's status."""
    with jobs_lock:
        if job_id not in jobs:
            jobs[job_id] = {}
        jobs[job_id]['status'] = status
        if message:
            jobs[job_id]['message'] = message
        if result_path:
            jobs[job_id]['result_path'] = result_path
        jobs[job_id]['total_videos'] = total_videos
        jobs[job_id]['completed_videos'] = completed_videos
        jobs[job_id]['current_video_title'] = current_video_title
        logging.info(f"Job {job_id} status updated: {status}, Message: {message}")


# --- Worker Functions ---

def do_single_mp3_download(job_id, url, output_dir):
    """Worker function to download a single video to MP3."""
    update_job_status(job_id, 'running', 'Starting download...', total_videos=1)
    
    def progress_hook(d):
        if d['status'] == 'downloading':
            title = d.get('info_dict', {}).get('title', 'Unknown video')
            update_job_status(job_id, 'running', f"Downloading '{title}'", total_videos=1, current_video_title=title)
        elif d['status'] == 'finished':
            title = d.get('info_dict', {}).get('title', 'Unknown video')
            update_job_status(job_id, 'running', f"Converting '{title}' to MP3...", total_videos=1, completed_videos=1, current_video_title=title)

    try:
        ydl_opts = get_ydl_options(output_dir)
        ydl_opts['progress_hooks'] = [progress_hook]
        
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            # Find the downloaded file
            filename = ydl.prepare_filename(info)
            base, _ = os.path.splitext(filename)
            mp3_file = base + '.mp3'
            
            if os.path.exists(mp3_file):
                update_job_status(job_id, 'completed', 'Download successful!', result_path=mp3_file)
            else:
                update_job_status(job_id, 'failed', f"Conversion failed. Expected MP3 not found: {mp3_file}")

    except Exception as e:
        logging.error(f"Error in job {job_id}: {e}", exc_info=True)
        update_job_status(job_id, 'failed', str(e))


def do_playlist_zip_download(job_id, url, output_dir, playlist_title):
    """Worker function to download a playlist and zip the MP3s."""
    playlist_folder = os.path.join(output_dir, playlist_title)
    os.makedirs(playlist_folder, exist_ok=True)
    update_job_status(job_id, 'running', 'Fetching playlist information...')

    try:
        # First, get playlist info without downloading
        info_ydl_opts = get_ydl_options(playlist_folder, playlist=True)
        info_ydl_opts['extract_flat'] = True
        with YoutubeDL(info_ydl_opts) as ydl:
            playlist_info = ydl.extract_info(url, download=False)
            video_entries = playlist_info.get('entries', [])
            total_videos = len(video_entries)
            update_job_status(job_id, 'running', f'Found {total_videos} videos.', total_videos=total_videos)

        completed_count = 0
        for i, entry in enumerate(video_entries):
            video_url = entry['url']
            video_title = entry.get('title', f'Video {i+1}')
            update_job_status(job_id, 'running', f'Downloading video {i+1}/{total_videos}: {video_title}', 
                              total_videos=total_videos, completed_videos=completed_count, current_video_title=video_title)
            
            try:
                video_ydl_opts = get_ydl_options(playlist_folder, playlist=False) # Process one-by-one
                with YoutubeDL(video_ydl_opts) as video_ydl:
                    video_ydl.download([video_url])
                completed_count += 1
                update_job_status(job_id, 'running', f'Completed {video_title}', total_videos=total_videos, completed_videos=completed_count)
            except Exception as e:
                logging.error(f"Skipping video '{video_title}' due to error: {e}")
                # Optionally, update status to reflect skipped video
                
        # Zip the directory
        update_job_status(job_id, 'running', 'Zipping files...', total_videos=total_videos, completed_videos=total_videos)
        zip_path = os.path.join(output_dir, f"{playlist_title}.zip")
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, _, files in os.walk(playlist_folder):
                for file in files:
                    if file.endswith('.mp3'):
                        zipf.write(os.path.join(root, file), arcname=file)
        
        # Clean up the folder
        shutil.rmtree(playlist_folder)

        update_job_status(job_id, 'completed', 'Playlist download and zip successful!', result_path=zip_path)

    except Exception as e:
        logging.error(f"Error in playlist job {job_id}: {e}", exc_info=True)
        update_job_status(job_id, 'failed', str(e))


# --- API Endpoints ---

@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    data = request.json
    url = data.get('url')
    output_dir = data.get('outputDir')
    if not url or not output_dir:
        return jsonify({'error': 'URL and output directory are required.'}), 400

    job_id = f"job-{os.urandom(4).hex()}"
    update_job_status(job_id, 'queued', 'Download job has been queued.')
    executor.submit(do_single_mp3_download, job_id, url, output_dir)
    
    return jsonify({'job_id': job_id})


@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    data = request.json
    url = data.get('url')
    output_dir = data.get('outputDir')
    playlist_title = data.get('playlistTitle', 'youtube_playlist')
    if not url or not output_dir:
        return jsonify({'error': 'URL and output directory are required.'}), 400
        
    job_id = f"job-{os.urandom(4).hex()}"
    update_job_status(job_id, 'queued', 'Playlist download job has been queued.')
    executor.submit(do_playlist_zip_download, job_id, url, output_dir, playlist_title)

    return jsonify({'job_id': job_id})


@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({'error': 'Job not found'}), 404
        return jsonify(job)


@app.route('/download/<job_id>', methods=['GET'])
def download_file(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job or job.get('status') != 'completed':
            return jsonify({'error': 'File not ready or job failed'}), 404
        
        result_path = job.get('result_path')
        if not result_path or not os.path.exists(result_path):
            return jsonify({'error': 'File not found'}), 404
            
    try:
        directory = os.path.dirname(result_path)
        filename = os.path.basename(result_path)
        return send_from_directory(directory, filename, as_attachment=True)
    except Exception as e:
        logging.error(f"Error sending file for job {job_id}: {e}", exc_info=True)
        return jsonify({'error': 'Could not send file'}), 500

# A simple health check endpoint
@app.route('/ping', methods=['GET'])
def ping():
    return "pong", 200


if __name__ == '__main__':
    # Default port, can be overridden by an environment variable
    port = int(os.environ.get("YT_LINK_BACKEND_PORT", 5001))
    app.run(host='127.0.0.1', port=port, debug=False)
