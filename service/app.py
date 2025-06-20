import sys
import os
import logging
from flask import Flask, request, jsonify
from yt_dlp import YoutubeDL
import threading
import uuid
import shutil
import traceback

# --- Basic Setup ---
# Set up detailed logging to a file. This is crucial for debugging packaged apps.
log_dir = os.path.join(os.path.expanduser("~"), "yt-link-logs")
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, "backend.log")
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler(sys.stdout) # Also print to console
    ]
)
app = Flask(__name__)
logging.info("Flask App Initialized")

# --- Job Management ---
jobs = {}

# --- Core Logic: Finding Packaged Binaries (Robust Version) ---
def get_resource_path(filename):
    """ Get absolute path to a resource, works for dev and for PyInstaller. """
    # When packaged by PyInstaller, the executable is in a temporary folder `_MEIPASS`.
    # `sys.executable` points to the running executable.
    if getattr(sys, 'frozen', False):
        # Path to the executable (e.g., .../backend/yt-link-backend.exe)
        executable_path = os.path.dirname(sys.executable)
        # The 'bin' directory is packaged at the same level as the 'backend' directory.
        # So we go up one level from the executable's location and then into 'bin'.
        resource_path = os.path.join(executable_path, '..', 'bin', filename)
        logging.info(f"Running frozen. Looking for {filename} at {resource_path}")
        return resource_path
    else:
        # In development, check the system's PATH.
        logging.info(f"Running in dev mode. Looking for '{filename.split('.')[0]}' in PATH.")
        return shutil.which(filename.split('.')[0])

# --- Get Paths for Binaries ---
ffmpeg_filename = 'ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg'
FFMPEG_PATH = get_resource_path(ffmpeg_filename)
logging.info(f"Final FFMPEG Path: {FFMPEG_PATH}")
if not FFMPEG_PATH or not os.path.exists(FFMPEG_PATH):
    logging.error("FATAL: Could not find ffmpeg executable!")
else:
    logging.info("SUCCESS: ffmpeg executable found.")


# --- Worker Functions for YouTube Downloads ---

def download_single_mp3(job_id, url, download_path, cookies_file_path=None):
    jobs[job_id] = {'status': 'processing', 'progress': 0, 'message': 'Starting download...'}
    try:
        logging.info(f"[{job_id}] Starting single MP3 download.")
        logging.info(f"[{job_id}] URL: {url}")
        logging.info(f"[{job_id}] Download Path: {download_path}")
        logging.info(f"[{job_id}] Cookies Path: {cookies_file_path}")

        def progress_hook(d):
            if d['status'] == 'downloading':
                percentage = d.get('_percent_str', '0%')
                jobs[job_id]['progress'] = float(percentage.strip('%'))
                jobs[job_id]['message'] = f"Downloading: {percentage}"
            elif d['status'] == 'finished':
                jobs[job_id]['message'] = 'Download finished, converting...'
                logging.info(f"[{job_id}] Finished download, starting postprocessing.")

        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(download_path, '%(title)s.%(ext)s'),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'progress_hooks': [progress_hook],
            'ffmpeg_location': FFMPEG_PATH,
            'cookiefile': cookies_file_path,
            'nocheckcertificate': True,
        }
        
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        jobs[job_id]['status'] = 'completed'
        jobs[job_id]['progress'] = 100
        jobs[job_id]['message'] = 'Successfully downloaded and converted to MP3.'
        logging.info(f"[{job_id}] Job completed successfully.")

    except Exception as e:
        # This is the most important part for debugging the 500 error
        logging.error(f"[{job_id}] An error occurred: {e}")
        logging.error(f"[{job_id}] Traceback: {traceback.format_exc()}")
        jobs[job_id] = {'status': 'error', 'message': f"An error occurred: {e}"}


# --- Flask API Endpoints ---

@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job_route():
    try:
        data = request.json
        if not all(k in data for k in ['url', 'downloadPath']):
            raise ValueError("Missing 'url' or 'downloadPath' in request")
        
        job_id = str(uuid.uuid4())
        thread = threading.Thread(target=download_single_mp3, args=(
            job_id,
            data['url'],
            data['downloadPath'],
            data.get('cookiesPath')
        ))
        thread.start()
        logging.info(f"Started job {job_id} for URL: {data['url']}")
        return jsonify({'job_id': job_id})
    except Exception as e:
        logging.error(f"Failed to start single mp3 job: {e}")
        logging.error(f"Request Data: {request.data}")
        logging.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({'error': str(e)}), 500


@app.route('/job-status/<job_id>', methods=['GET'])
def job_status_route(job_id):
    job = jobs.get(job_id)
    if job:
        return jsonify(job)
    return jsonify({'status': 'not_found'}), 404

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    logging.info(f"Starting Flask server on port {port}")
    app.run(port=port, host='127.0.0.1')
