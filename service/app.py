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
from flask import Flask, request, send_file, jsonify, after_this_request, send_from_directory
from urllib.parse import quote
from flask_cors import CORS

# --- Logging Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s')

# --- Helper to find bundled executables (for PyInstaller) ---
def find_executable(name):
    if getattr(sys, 'frozen', False):
        base_path = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        exe_name = f"{name}.exe" if sys.platform == "win32" else name
        exe_path = os.path.join(base_path, exe_name)
        if os.path.exists(exe_path):
            logging.info(f"Found bundled executable '{name}' at: {exe_path}")
            return exe_path
        logging.error(f"Could not find bundled '{name}' at expected path: {exe_path}")
    
    fallback_path = shutil.which(name)
    if fallback_path:
        logging.info(f"Found executable '{name}' in system PATH: {fallback_path}")
    return fallback_path

# --- Find and verify required executables ---
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

def sanitize_fs_filename(name):
    return re.sub(r'[\\/*?:"<>|]', "_", name).strip() or 'untitled_file'

def run_subprocess(job_id, command, timeout):
    logging.info(f"[{job_id}] Running command: {' '.join(command)}")
    process = subprocess.run(
        command,
        timeout=timeout,
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace'
    )
    if process.stdout:
        logging.info(f"[{job_id}] STDOUT: {process.stdout.strip()}")
    if process.stderr:
        logging.warning(f"[{job_id}] STDERR: {process.stderr.strip()}")
    return process

# --- Background Task for Single MP3 Download ---
def _process_single_mp3_task(job_id, url, cookie_data):
    logging.info(f"[{job_id}] Starting single MP3 task for URL: {url}")
    if not YTDLP_PATH or not FFMPEG_PATH:
        with jobs_lock: jobs[job_id].update({"status": "failed", "error": "Server misconfiguration: yt-dlp or ffmpeg missing."})
        return

    job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_single_")
    try:
        with jobs_lock: jobs[job_id].update({"status": "processing", "job_tmp_dir": job_tmp_dir, "message": "Downloading audio..."})

        output_template = os.path.join(job_tmp_dir, '%(title)s.%(ext)s')
        args = [YTDLP_PATH, '-x', '--audio-format', 'mp3', '--no-playlist', '--ffmpeg-location', FFMPEG_PATH, '-o', output_template, '--']
        if cookie_data:
            cookie_file = os.path.join(job_tmp_dir, 'cookies.txt')
            with open(cookie_file, 'w', encoding='utf-8') as f: f.write(cookie_data)
            args.extend(['--cookies', cookie_file])
        args.append(url)
        
        process = run_subprocess(job_id, args, 600)
        
        mp3_file = next((f for f in os.listdir(job_tmp_dir) if f.lower().endswith('.mp3')), None)
        if not mp3_file or process.returncode != 0:
            raise Exception(f"yt-dlp failed. Exit code: {process.returncode}. Error: {process.stderr[:500]}")
        
        full_path = os.path.join(job_tmp_dir, mp3_file)
        with jobs_lock: jobs[job_id].update({"status": "completed", "filename": mp3_file, "filepath": full_path, "message": f"Completed: {mp3_file}"})

    except Exception as e:
        error_message = f"Error in single MP3 task: {e}"
        logging.error(f"[{job_id}] {error_message}", exc_info=True)
        with jobs_lock: jobs[job_id].update({"status": "failed", "error": error_message, "message": "Failed."})

# --- Background Task for Playlist Zip ---
def _process_playlist_zip_task(job_id, playlist_url, cookie_data):
    logging.info(f"[{job_id}] Starting playlist zip task for URL: {playlist_url}")
    if not YTDLP_PATH or not FFMPEG_PATH:
        with jobs_lock: jobs[job_id].update({"status": "failed", "error": "Server misconfiguration: yt-dlp or ffmpeg missing."})
        return

    job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_zip_")
    try:
        with jobs_lock: jobs[job_id].update({"status": "processing", "job_tmp_dir": job_tmp_dir, "message": "Downloading playlist audio..."})
        
        output_template = os.path.join(job_tmp_dir, '%(playlist_index)03d.%(title)s.%(ext)s')
        args = [YTDLP_PATH, '-x', '--audio-format', 'mp3', '--yes-playlist', '--ignore-errors', '--ffmpeg-location', FFMPEG_PATH, '-o', output_template, '--']
        if cookie_data:
            cookie_file = os.path.join(job_tmp_dir, 'cookies.txt')
            with open(cookie_file, 'w', encoding='utf-8') as f: f.write(cookie_data)
            args.extend(['--cookies', cookie_file])
        args.append(playlist_url)

        run_subprocess(job_id, args, 1800)

        mp3_files = [f for f in os.listdir(job_tmp_dir) if f.lower().endswith('.mp3')]
        if not mp3_files:
            raise Exception("yt-dlp did not produce any MP3 files.")

        with jobs_lock: jobs[job_id].update({"status": "processing", "message": f"Zipping {len(mp3_files)} files..."})
        zip_filename = f"playlist_{job_id}.zip"
        zip_path = os.path.join(job_tmp_dir, zip_filename)
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for file in mp3_files:
                zipf.write(os.path.join(job_tmp_dir, file), arcname=file)

        with jobs_lock: jobs[job_id].update({"status": "completed", "filename": zip_filename, "filepath": zip_path, "message": f"Completed: {zip_filename}"})

    except Exception as e:
        error_message = f"Error in playlist zip task: {e}"
        logging.error(f"[{job_id}] {error_message}", exc_info=True)
        with jobs_lock: jobs[job_id].update({"status": "failed", "error": error_message, "message": "Failed."})


# --- Centralized Job Starter ---
def start_job(target_function, **kwargs):
    if not YTDLP_PATH or not FFMPEG_PATH:
        return jsonify({"error": "Server is not configured correctly. Executables missing."}), 500
    
    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {"status": "queued", "message": "Job is queued."}
    
    thread_args = (job_id,) + tuple(kwargs.values())
    thread = threading.Thread(target=target_function, args=thread_args, name=f"Job-{job_id[:8]}")
    thread.start()
    
    return jsonify({"jobId": job_id}), 202

@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job_route():
    data = request.get_json()
    return start_job(_process_single_mp3_task, url=data.get('url'), cookie_data=data.get('cookieData'))

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job_route():
    data = request.get_json()
    return start_job(_process_playlist_zip_task, playlist_url=data.get('playlistUrl'), cookie_data=data.get('cookieData'))

# The combine playlist feature is complex. This simplified version will not be included for now to ensure stability.
# If you wish to re-add it, it needs to be carefully re-implemented.
# @app.route('/start-combine-playlist-mp3-job', methods=['POST'])
# def start_combine_playlist_mp3_job_route():
#     data = request.get_json()
#     return start_job(_process_combine_playlist_mp3_task, playlist_url=data.get('playlistUrl'), cookie_data=data.get('cookieData'))


# --- Job Status and Download Endpoints ---
@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status_route(job_id): 
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        return jsonify(job.copy())

@app.route('/download-file/<job_id>/<filename>', methods=['GET'])
def download_processed_file(job_id, filename):
    with jobs_lock:
        job = jobs.get(job_id, {})
        job_dir = job.get("job_tmp_dir")
        file_path = job.get("filepath")
    
    if not job or job.get("status") != "completed" or not file_path or not os.path.exists(file_path):
        return jsonify({"error": "File not ready or not found"}), 404
        
    @after_this_request
    def cleanup(response):
        if job_dir and os.path.exists(job_dir):
            try:
                shutil.rmtree(job_dir)
                logging.info(f"[{job_id}] Cleaned up temporary directory: {job_dir}")
            except Exception as e:
                logging.error(f"[{job_id}] Error cleaning up directory {job_dir}: {e}")
        with jobs_lock:
            if job_id in jobs:
                del jobs[job_id]
        return response

    return send_from_directory(os.path.dirname(file_path), os.path.basename(file_path), as_attachment=True)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)
