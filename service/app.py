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
import re
from flask import Flask, request, jsonify, after_this_request, send_from_directory
from flask_cors import CORS

# --- Logging Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s')

# --- Helper to find bundled executables ---
def find_executable(name):
    """Finds an executable, accounting for being bundled by PyInstaller."""
    if getattr(sys, 'frozen', False):
        base_path = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        exe_name = f"{name}.exe" if sys.platform == "win32" else name
        exe_path = os.path.join(base_path, exe_name)
        if os.path.exists(exe_path):
            logging.info(f"Found bundled executable '{name}' at: {exe_path}")
            return exe_path
        logging.error(f"Could not find bundled '{name}' at expected path: {exe_path}")
        return None
    
    fallback_path = shutil.which(name)
    if fallback_path:
        logging.info(f"Found executable '{name}' in system PATH: {fallback_path}")
    return fallback_path

# --- Global App Setup ---
YTDLP_PATH = find_executable("yt-dlp")
FFMPEG_PATH = find_executable("ffmpeg")
app = Flask(__name__)
CORS(app)
jobs = {}
jobs_lock = threading.Lock()

# --- Global Error Handler ---
@app.errorhandler(Exception)
def handle_global_exception(e):
    logging.error(f"Unhandled exception: {e}", exc_info=True)
    return jsonify(error="An unexpected internal server error occurred.", details=str(e)), 500

# --- Helper Functions ---
def sanitize_fs_filename(name):
    """Removes illegal characters from a filename."""
    return re.sub(r'[\\/*?:"<>|]', "_", name).strip() or 'untitled_file'

def run_subprocess(job_id, command, timeout):
    """A centralized function to run commands and log their output."""
    logging.info(f"[{job_id}] Running command: {' '.join(command)}")
    process = subprocess.run(
        command, timeout=timeout, capture_output=True, text=True, encoding='utf-8', errors='replace', check=False
    )
    if process.stdout: logging.info(f"[{job_id}] STDOUT: {process.stdout.strip()}")
    if process.stderr: logging.warning(f"[{job_id}] STDERR: {process.stderr.strip()}")
    return process

def update_job_status(job_id, status, **kwargs):
    """Thread-safe way to update a job's status."""
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update({"status": status, **kwargs})

def handle_job_exception(job_id, e, task_name):
    """Centralized exception handling for jobs."""
    error_message = f"Error in {task_name}: {e}"
    logging.error(f"[{job_id}] {error_message}", exc_info=True)
    # FIX: Pass the detailed error message back to the frontend.
    update_job_status(job_id, "failed", message=f"Failed: An error occurred in {task_name}.", error_detail=str(e))

# --- Task Functions ---
def _process_single_mp3_task(job_id, url, cookie_data):
    """Target function for the single MP3 download thread."""
    try:
        job_tmp_dir = jobs.get(job_id, {}).get("job_tmp_dir")
        if not job_tmp_dir: raise Exception("Job temporary directory not found.")
        update_job_status(job_id, "processing", message="Downloading audio...")
        
        output_template = os.path.join(job_tmp_dir, '%(title)s.%(ext)s')
        args = [YTDLP_PATH, '-x', '--audio-format', 'mp3', '--no-playlist', '--ffmpeg-location', FFMPEG_PATH, '-o', output_template]
        if cookie_data:
            cookie_file = os.path.join(job_tmp_dir, 'cookies.txt')
            with open(cookie_file, 'w', encoding='utf-8') as f: f.write(cookie_data)
            args.extend(['--cookies', cookie_file])
        args.extend(['--', url])
        
        process = run_subprocess(job_id, args, 600)
        
        mp3_file = next((f for f in os.listdir(job_tmp_dir) if f.lower().endswith('.mp3')), None)
        if process.returncode != 0 or not mp3_file:
            # FIX: Raise a more informative error.
            raise Exception(f"yt-dlp failed. Exit Code: {process.returncode}. Details: {process.stderr[:500]}")
        
        update_job_status(job_id, "completed", message=f"Completed: {mp3_file}", filename=mp3_file, filepath=os.path.join(job_tmp_dir, mp3_file))
    except Exception as e:
        handle_job_exception(job_id, e, "single MP3 task")

def _process_playlist_zip_task(job_id, playlist_url, cookie_data):
    """Target function for the playlist zip download thread."""
    try:
        job_tmp_dir = jobs.get(job_id, {}).get("job_tmp_dir")
        if not job_tmp_dir: raise Exception("Job temporary directory not found.")
        update_job_status(job_id, "processing", message="Downloading playlist...")

        output_template = os.path.join(job_tmp_dir, '%(playlist_index)03d - %(title)s.%(ext)s')
        args = [YTDLP_PATH, '-x', '--audio-format', 'mp3', '--yes-playlist', '--ignore-errors', '--ffmpeg-location', FFMPEG_PATH, '-o', output_template]
        if cookie_data:
            cookie_file = os.path.join(job_tmp_dir, 'cookies.txt')
            with open(cookie_file, 'w', encoding='utf-8') as f: f.write(cookie_data)
            args.extend(['--cookies', cookie_file])
        args.extend(['--', playlist_url])

        run_subprocess(job_id, args, 1800)
        
        mp3_files = sorted([f for f in os.listdir(job_tmp_dir) if f.lower().endswith('.mp3')])
        if not mp3_files:
            # FIX: Raise a more informative error.
            raise Exception("yt-dlp process finished, but no MP3 files were created.")

        update_job_status(job_id, "processing", message=f"Zipping {len(mp3_files)} files...")
        zip_filename = f"playlist_{job_id}.zip"
        zip_path = os.path.join(job_tmp_dir, zip_filename)
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file in mp3_files:
                zipf.write(os.path.join(job_tmp_dir, file), arcname=file)

        update_job_status(job_id, "completed", message=f"Completed: {zip_filename}", filename=zip_filename, filepath=zip_path)
    except Exception as e:
        handle_job_exception(job_id, e, "playlist zip task")

# --- API Endpoints ---
def start_job(target_function, **kwargs):
    """Generic function to start any job in a new thread."""
    if not all([YTDLP_PATH, FFMPEG_PATH]):
        return jsonify({"error": "Server is not configured correctly; executables missing."}), 500
    job_id = str(uuid.uuid4())
    job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_")
    with jobs_lock: jobs[job_id] = {"status": "queued", "job_tmp_dir": job_tmp_dir}
    
    thread = threading.Thread(target=target_function, args=(job_id,) + tuple(kwargs.values()), name=f"Job-{job_id[:8]}")
    thread.start()
    return jsonify({"jobId": job_id})

@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job_route():
    data = request.get_json(force=True)
    return start_job(_process_single_mp3_task, url=data.get('url'), cookie_data=data.get('cookieData'))

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job_route():
    data = request.get_json(force=True)
    return start_job(_process_playlist_zip_task, playlist_url=data.get('playlistUrl'), cookie_data=data.get('cookieData'))

@app.route('/job-status/<job_id>')
def get_job_status_route(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
        return jsonify(job.copy() if job else {"status": "not_found", "message": "Job not found"})

@app.route('/download-file/<job_id>/<filename>')
def download_file_route(job_id, filename):
    with jobs_lock:
        job = jobs.get(job_id, {})
        job_dir = job.get("job_tmp_dir")
        file_path = job.get("filepath")

    if not all([job, job.get("status") == "completed", file_path, os.path.exists(file_path)]):
        return jsonify({"error": "File not ready or not found"}), 404
        
    @after_this_request
    def cleanup(response):
        if job_dir and os.path.exists(job_dir):
            shutil.rmtree(job_dir, ignore_errors=True)
            logging.info(f"[{job_id}] Cleaned up temporary directory: {job_dir}")
        with jobs_lock:
            if job_id in jobs: del jobs[job_id]
        return response

    return send_from_directory(os.path.dirname(file_path), os.path.basename(file_path), as_attachment=True)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)
