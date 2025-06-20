import sys
import os
import shutil
import logging
import threading
import uuid
import zipfile
import stat
from queue import Queue, Empty
from flask import Flask, request, jsonify, send_from_directory
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
APP_PORT = int(os.environ.get('YT_LINK_BACKEND_PORT', 8080))

# --- Static File Serving Setup (Fix for 404 Error) ---
resources_path = os.environ.get('YT_LINK_RESOURCES_PATH')
if resources_path:
    build_dir = os.path.join(resources_path, 'app', 'frontend', 'out')
else:
    build_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'out')

logging.info(f"Serving static files from directory: {build_dir}")

app = Flask(__name__, static_folder=build_dir, static_url_path='/')
CORS(app)
jobs = {}
cleanup_queue = Queue()

# --- Static File Serving Routes ---
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

# --- Core Helper Functions (with ffmpeg fix) ---

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
        logging.error("CRITICAL: 'YT_LINK_RESOURCES_PATH' environment variable not set.")
        return None
    bin_dir = os.path.join(rp, 'bin')
    exe_path = os.path.join(bin_dir, name if sys.platform != "win32" else f"{name}.exe")
    logging.debug(f"Searching for '{name}' at full path: '{exe_path}'")
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
        'logger': YtdlpLogger(),
        'progress_hooks': [],
        'verbose': True,
    }

def create_job(target_function, *args):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'pending', 'message': 'Job is queued.'}
    thread = threading.Thread(target=target_function, args=(job_id,) + args)
    thread.daemon = True
    thread.start()
    return job_id

# --- Target Worker Functions ---

def do_download_single_mp3(job_id, url, download_path):
    jobs[job_id]['status'] = 'running'
    jobs[job_id]['message'] = 'Preparing to download...'
    os.makedirs(download_path, exist_ok=True)
    try:
        ydl_opts = get_ydl_options(download_path)
        with YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=True)
            base, _ = os.path.splitext(ydl.prepare_filename(info_dict))
            final_mp3_path = base + '.mp3'
            
            if os.path.exists(final_mp3_path):
                jobs[job_id].update({'status': 'completed', 'message': 'MP3 created successfully.', 'result': final_mp3_path})
            else:
                raise Exception("Conversion to MP3 failed. The final .mp3 file was not found.")
    except Exception as e:
        logging.error(f"Job {job_id} failed: {e}", exc_info=True)
        jobs[job_id].update({'status': 'failed', 'message': str(e)})

# --- API Endpoints ---

@app.route('/api/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    data = request.json
    url = data.get('url')
    download_path = data.get('downloadPath')
    if not url or not download_path:
        return jsonify({'error': 'Missing URL or downloadPath'}), 400
    
    job_id = create_job(do_download_single_mp3, url, download_path)
    return jsonify({'jobId': job_id})

@app.route('/api/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    return jsonify({'error': 'Playlist zip is not yet implemented'}), 501

@app.route('/api/job-status/<job_id>', methods=['GET'])
def get_job_status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    return jsonify(job)

# --- Main Execution ---
if __name__ == '__main__':
    logging.info(f"--- Starting Flask server on http://127.0.0.1:{APP_PORT} ---")
    app.run(host='127.0.0.1', port=APP_PORT)
