import os
import sys
import shutil
import logging
import subprocess
import tempfile
import zipfile
import json
import uuid
import threading
from flask import Flask, request, send_file, jsonify, Response, stream_with_context, after_this_request, send_from_directory
from urllib.parse import quote
from flask_cors import CORS
from functools import cmp_to_key
import re

# --- Logging Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Definitive Helper to find bundled executables (for PyInstaller) ---
def find_executable(name):
    """
    Finds an executable, accounting for being bundled by PyInstaller in a --onefile build.
    """
    # Check if the application is running in a bundled PyInstaller environment
    if getattr(sys, 'frozen', False):
        # For a --onefile bundle, the path is to a temporary folder where the app is unpacked.
        # This temporary path is stored in sys._MEIPASS.
        base_path = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        
        # On Windows, executables have a .exe extension
        exe_name = f"{name}.exe" if sys.platform == "win32" else name
        exe_path = os.path.join(base_path, exe_name)
        
        if os.path.exists(exe_path):
            logging.info(f"Found bundled executable '{name}' at: {exe_path}")
            return exe_path
        else:
            logging.warning(f"Could not find bundled executable '{name}' at expected path: {exe_path}")
    
    # If not bundled, or if not found in the bundle, search the system's PATH as a fallback.
    fallback_path = shutil.which(name)
    if fallback_path:
        logging.info(f"Found executable '{name}' in system PATH: {fallback_path}")
    return fallback_path

# --- Find and verify required executables ---
YTDLP_PATH = find_executable("yt-dlp")
if not YTDLP_PATH:
    logging.error("CRITICAL ERROR: yt-dlp executable not found.")
else:
    logging.info(f"Using yt-dlp at: {YTDLP_PATH}")

FFMPEG_PATH = find_executable("ffmpeg")
if not FFMPEG_PATH:
    logging.warning("ffmpeg executable not found. Some operations may fail.")
else:
    logging.info(f"Using ffmpeg at: {FFMPEG_PATH}")

app = Flask(__name__)
CORS(app)

# In-memory store for job statuses and file paths
jobs = {}
jobs_lock = threading.Lock()

# --- Global Error Handler ---
@app.errorhandler(Exception)
def handle_global_exception(e):
    job_id_in_context = getattr(request, 'job_id_in_context', None)
    log_prefix = f"[{job_id_in_context}] " if job_id_in_context else ""
    logging.error(f"{log_prefix}Unhandled exception: {e}", exc_info=True)
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return jsonify(error=str(e.name), details=str(e.description)), e.code
    return jsonify(error="An unexpected internal server error occurred.", details=str(e)), 500

# Helper to encode filename for Content-Disposition
def sanitize_filename_header(filename):
    return quote(filename)

# Helper function to sort files based on playlist index prefix
def sort_files_by_playlist_index_comparator(a_item, b_item):
    regex = r'^(\d+)\.'
    match_a = re.match(regex, os.path.basename(a_item)) 
    match_b = re.match(regex, os.path.basename(b_item))
    
    index_a = int(match_a.group(1)) if match_a else float('inf')
    index_b = int(match_b.group(1)) if match_b else float('inf')

    if index_a < index_b:
        return -1
    if index_a > index_b:
        return 1
    return 0

# Helper to sanitize filenames for the filesystem
def sanitize_fs_filename(name):
    name = name.replace('/', '_').replace('\\', '_').replace(':', '_').replace('*', '_').replace('?', '_').replace('"', '_').replace('<', '_').replace('>', '_').replace('|', '_')
    return name.strip() or 'untitled_file'

# --- Background Task for Single MP3 Download ---
def _process_single_mp3_task(job_id, url, cookie_data):
    logging.info(f"[{job_id}] Background task started for single MP3: {url}")
    
    if not YTDLP_PATH:
        logging.error(f"[{job_id}] YTDLP_PATH not defined, cannot process task.")
        with jobs_lock:
            jobs[job_id].update({"status": "failed", "error": "Server misconfiguration: yt-dlp path is not set.", "message": "Failed: Server is misconfigured."})
        return

    job_tmp_dir = None
    try:
        job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_single_")
        with jobs_lock:
            jobs[job_id].update({"status": "processing_download", "job_tmp_dir": job_tmp_dir, "message": "Downloading single MP3..."})

        output_template = os.path.join(job_tmp_dir, '%(title)s.%(ext)s')
        args = [ YTDLP_PATH, '-i', '-x', '--audio-format', 'mp3', '-o', output_template, '--no-playlist', '--no-warnings', '--verbose' ]
        if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
            cookie_file_path = os.path.join(job_tmp_dir, 'cookies.txt')
            with open(cookie_file_path, 'w', encoding='utf-8') as f: f.write(cookie_data)
            args.extend(['--cookies', cookie_file_path])
        args.extend(['--', url])

        process = subprocess.run( args, check=False, timeout=600, capture_output=True, text=True, encoding='utf-8', errors='replace')
        
        logging.info(f"[{job_id}] yt-dlp stdout:\n{process.stdout}")
        if process.stderr: 
            logging.warning(f"[{job_id}] yt-dlp stderr:\n{process.stderr}")

        mp3_file_name = next((f for f in os.listdir(job_tmp_dir) if f.lower().endswith('.mp3') and not f == 'cookies.txt'), None)

        if mp3_file_name:
            full_mp3_path = os.path.join(job_tmp_dir, mp3_file_name)
            with jobs_lock:
                jobs[job_id].update({"status": "completed", "filename": mp3_file_name, "filepath": full_mp3_path, "message": f"Completed: {mp3_file_name}"})
        else:
            raise Exception(f"yt-dlp did not produce an MP3 file. Exit code: {process.returncode}.")
    except Exception as e: 
        error_message = f"Error in single MP3 task: {str(e)}"
        logging.error(f"[{job_id}] {error_message}", exc_info=True)
        with jobs_lock:
            jobs[job_id].update({"status": "failed", "error": error_message, "message": f"Failed: {error_message}"})
    # ... (rest of your functions) ...

# --- "Start Job" Endpoints ---
@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    json_data = request.get_json()
    url = json_data.get('url')
    if not YTDLP_PATH: return jsonify({"error": "Server configuration error: yt-dlp not found."}), 500
    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {"status": "queued"}
    thread = threading.Thread(target=_process_single_mp3_task, args=(job_id, url, json_data.get('cookieData')))
    thread.start()
    return jsonify({"jobId": job_id}), 202

# (The rest of your endpoints remain the same)
# ...

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)
