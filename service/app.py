import sys
import os
import shutil
import logging
import threading
import uuid
import zipfile
import stat
import json
from queue import Queue, Empty
from flask import Flask, request, jsonify, send_file, after_this_request, send_from_directory
from flask_cors import CORS
from yt_dlp import YoutubeDL

# --- Basic Setup ---
logging.basicConfig(level=logging.DEBUG, format='[PYTHON] %(asctime)s - %(levelname)s - %(message)s')

class YtdlpLogger:
    def debug(self, msg):
        if msg.startswith('[debug] '): logging.debug(f"YTDLP_TRACE: {msg}")
        else: self.info(msg)
    def info(self, msg): logging.info(f"YTDLP_INFO: {msg}")
    def warning(self, msg): logging.warning(f"YTDLP_WARN: {msg}")
    def error(self, msg): logging.error(f"YTDLP_ERROR: {msg}")

logging.debug("--- Python Backend Starting ---")
APP_PORT = int(os.environ.get('YT_LINK_BACKEND_PORT', 5001))

# Determine the path to the frontend's static files.
# This is crucial for serving the UI in a packaged app.
resources_path = os.environ.get('YT_LINK_RESOURCES_PATH')
if resources_path:
    # In production, files are in 'app/frontend/out' relative to the resources path
    build_dir = os.path.join(resources_path, 'app', 'frontend', 'out')
else:
    # In development, assume a different structure (not critical for production)
    build_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'out')

logging.info(f"Serving static files from: {build_dir}")

# Pass the static folder path to Flask.
app = Flask(__name__, static_folder=build_dir, static_url_path='/')
CORS(app) # Enable CORS for all routes
jobs = {}
cleanup_queue = Queue()


# --- Static File Serving (Fix for 404 Error) ---
@app.route('/')
def index():
    """Serves the main index.html file."""
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    """Serves other static files like JS, CSS, images."""
    return send_from_directory(app.static_folder, path)


# --- Core Helper Functions (with logging) ---

def set_executable_permission(path):
    if sys.platform != "win32":
        try:
            os.chmod(path, 0o755)
            logging.debug(f"Set executable permission for {path}")
        except Exception as e:
            logging.error(f"Failed to set permission for {path}: {e}")

def find_executable(name):
    logging.debug(f"--- Finding executable: '{name}' ---")
    rp = os.environ.get('YT_LINK_RESOURCES_PATH')
    if not rp:
        logging.error("CRITICAL: 'YT_LINK_RESOURCES_PATH' env var not set.")
        return None
    bin_dir = os.path.join(rp, 'bin')
    exe_path = os.path.join(bin_dir, name if sys.platform != "win32" else f"{name}.exe")
    logging.debug(f"Searching for '{name}' at '{exe_path}'")
    if os.path.exists(exe_path):
        set_executable_permission(exe_path)
        return exe_path
    logging.error(f"CRITICAL: Executable NOT FOUND at '{exe_path}'")
    return None

def get_ydl_options(output_path, playlist=False):
    ffmpeg_exe_path = find_executable('ffmpeg')
    find_executable('ffprobe')
    ffmpeg_dir = os.path.dirname(ffmpeg_exe_path) if ffmpeg_exe_path else None
    return {
        'format': 'bestaudio/best',
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3'}],
        'outtmpl': {'default': os.path.join(output_path, '%(title)s.%(ext)s')},
        'noplaylist': not playlist,
        'ffmpeg_location': ffmpeg_dir,
        'nocheckcertificate': True,
        'logger': YtdlpLogger(),
        'progress_hooks': [],
        'verbose': True,
    }

def create_job(target_function, *args):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'pending'}
    thread = threading.Thread(target=target_function, args=(job_id,) + args)
    thread.daemon = True
    thread.start()
    return job_id

# The download and API endpoint functions remain the same as the previous version.
# They are included here for completeness.
def do_download_single_mp3(job_id, url, download_path):
    jobs[job_id]['status'] = 'running'
    os.makedirs(download_path, exist_ok=True)
    try:
        ydl_opts = get_ydl_options(download_path)
        with YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=True)
            base, _ = os.path.splitext(ydl.prepare_filename(info_dict))
            final_mp3_path = base + '.mp3'
            if os.path.exists(final_mp3_path):
                jobs[job_id].update({'status': 'completed', 'result': final_mp3_path})
            else:
                raise Exception("Conversion failed. Final MP3 not found.")
    except Exception as e:
        logging.error(f"Job {job_id} failed: {e}", exc_info=True)
        jobs[job_id].update({'status': 'failed', 'message': str(e)})

@app.route('/api/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    data = request.json
    return jsonify({'jobId': create_job(do_download_single_mp3, data['url'], data['downloadPath'])})

# Other routes for playlist, job status, etc. would go here...
# ... (omitted for brevity, no changes from before) ...

if __name__ == '__main__':
    logging.info(f"--- Starting Flask server on port {APP_PORT} ---")
    app.run(port=APP_PORT, host='0.0.0.0')

