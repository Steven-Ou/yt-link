

import sys
import os
import json
import logging
import shutil
import tempfile
import zipfile
from flask import Flask, request, jsonify, send_from_directory
from yt_dlp import YoutubeDL
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

# --- Basic Setup ---
app = Flask(__name__)

# Configure logging
log_dir = os.path.join(os.path.expanduser("~"), ".yt-link-logs")
os.makedirs(log_dir, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(log_dir, "backend.log")),
        logging.StreamHandler(sys.stdout)
    ]
)

# --- Global State ---
jobs = {}
jobs_lock = Lock()
executor = ThreadPoolExecutor(max_workers=4)

# --- Core Functions ---

def find_executable(name):
    """Finds an executable, accounting for being bundled for production."""
    if getattr(sys, 'frozen', False):
        # In a packaged app, the executable is in a 'bin' folder
        # relative to the main executable's directory.
        base_path = os.path.dirname(sys.executable)
        # The 'backend' executable is in 'Resources/backend', ffmpeg is in 'Resources/bin'
        # So we go up one level from 'backend' and then into 'bin'.
        bin_path = os.path.join(base_path, '..', 'bin')
        exe_name = f"{name}.exe" if sys.platform == "win32" else name
        exe_path = os.path.join(bin_path, exe_name)
        if os.path.exists(exe_path):
            logging.info(f"Found bundled executable '{name}' at: {exe_path}")
            return exe_path
        # Log an error if it's not found where expected.
        logging.error(f"Could not find bundled '{name}' at expected path: {exe_path}")
        return None
    
    # For local development, find the executable in the system's PATH.
    fallback_path = shutil.which(name)
    if fallback_path:
        logging.info(f"Found executable '{name}' in system PATH: {fallback_path}")
    return fallback_path

def get_ydl_options(output_path, playlist=False):
    """Gets the base options for yt-dlp, correctly specifying the ffmpeg path."""
    ffmpeg_executable_path = find_executable('ffmpeg')

    if ffmpeg_executable_path:
        logging.info(f"Found ffmpeg executable at: {ffmpeg_executable_path}")
    else:
        logging.error("FFmpeg executable not found! Post-processing will fail.")

    return {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'outtmpl': os.path.join(output_path, '%(title)s.%(ext)s'),
        'noplaylist': not playlist,
        'ffmpeg_location': ffmpeg_executable_path,
        'quiet': True,
        'progress_hooks': [],
        'nocheckcertificate': True,
    }

def update_job_status(job_id, status, message=None, result_path=None, **kwargs):
    """Thread-safe way to update a job's status."""
    with jobs_lock:
        if job_id not in jobs:
            jobs[job_id] = {}
        jobs[job_id]['status'] = status
        if message:
            jobs[job_id]['message'] = message
        if result_path:
            jobs[job_id]['result_path'] = result_path
        # Update any other dynamic properties
        for key, value in kwargs.items():
            jobs[job_id][key] = value
        logging.info(f"Job {job_id} updated: {status}, Message: {message}")

# --- Worker Functions ---

def do_single_mp3_download(job_id, url, output_dir, cookie_content):
    """Worker function to download a single video to MP3."""

    def progress_hook(d):
        if d['status'] == 'finished':
            update_job_status(job_id, 'processing', 'Download finished. Converting to MP3...')
    
    update_job_status(job_id, 'processing', 'Starting download...', total_videos=1)
    
    try:
        ydl_opts = get_ydl_options(output_dir)
        ydl_opts['progress_hooks'] = [progress_hook]
        
        cookie_file = None
        if cookie_content:
            fd, cookie_file = tempfile.mkstemp(text=True)
            with os.fdopen(fd, 'w') as tmp:
                tmp.write(cookie_content)
            ydl_opts['cookiefile'] = cookie_file

        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
            base, _ = os.path.splitext(filename)
            mp3_file = base + '.mp3'
            
            if os.path.exists(mp3_file):
                update_job_status(job_id, 'completed', 'Download successful!', result_path=mp3_file)
            else:
                # This case can happen if ffmpeg fails post-processing
                raise Exception("Conversion failed. The final MP3 file was not created.")

        if cookie_file:
            os.remove(cookie_file)

    except Exception as e:
        logging.error(f"Error in job {job_id}: {e}", exc_info=True)
        # Relay the exact error message to the frontend.
        update_job_status(job_id, 'failed', str(e))

# --- API Endpoints ---
# These routes were missing in the previous snippet I provided.

@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    data = request.json
    url = data.get('url')
    output_dir = data.get('outputDir') # The main process now provides this.
    cookie_content = data.get('cookieFileContent')

    if not url or not output_dir:
        return jsonify({'error': 'URL and output directory are required.'}), 400

    job_id = f"job-{os.urandom(4).hex()}"
    update_job_status(job_id, 'queued', 'Download job has been queued.')
    # Submit the job to the thread pool for background processing.
    executor.submit(do_single_mp3_download, job_id, url, output_dir, cookie_content)
    
    return jsonify({'job_id': job_id})

# --- Placeholder endpoints for other features ---
@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    # This logic would be similar to the single MP3 download but for playlists.
    return jsonify({'error': 'Not yet implemented'}), 501

@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job():
    return jsonify({'error': 'Not yet implemented'}), 501

# --- Job Status and Download ---
@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({'error': 'Job not found', 'status': 'not_found'}), 404
        return jsonify(job)

@app.route('/download/<job_id>', methods=['GET'])
def download_file(job_id):
    # This endpoint is no longer used by the frontend. The main process handles saving.
    return jsonify({'error': 'This endpoint is deprecated.'}), 404

# --- Main Execution ---
if __name__ == '__main__':
    port = int(os.environ.get("YT_LINK_BACKEND_PORT", 5001))
    app.run(host='127.0.0.1', port=port, debug=False)