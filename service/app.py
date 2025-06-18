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
# Sets up logging to print info-level messages and above to the console.
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s')

# --- Helper to find bundled executables ---
def find_executable(name):
    """Finds an executable, accounting for being bundled by PyInstaller for production."""
    # If the app is a "frozen" executable (created by PyInstaller).
    if getattr(sys, 'frozen', False):
        # The base path is the directory of the executable.
        base_path = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        exe_name = f"{name}.exe" if sys.platform == "win32" else name
        exe_path = os.path.join(base_path, exe_name)
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

# --- Global App Setup ---
YTDLP_PATH = find_executable("yt-dlp")
FFMPEG_PATH = find_executable("ffmpeg")
app = Flask(__name__)
CORS(app)  # Enable Cross-Origin Resource Sharing
jobs = {}  # In-memory dictionary to store job statuses.
jobs_lock = threading.Lock() # A lock to make jobs dictionary thread-safe.

# --- Global Error Handler ---
@app.errorhandler(Exception)
def handle_global_exception(e):
    """Catches any unhandled errors in the Flask app."""
    logging.error(f"Unhandled exception: {e}", exc_info=True)
    return jsonify(error="An unexpected internal server error occurred.", details=str(e)), 500

# --- Helper Functions ---
def sanitize_filename(name):
    """Removes illegal characters from a filename to make it safe for the filesystem."""
    return re.sub(r'[\\/*?:"<>|]', "_", name).strip() or 'untitled_file'

def run_subprocess(job_id, command, timeout):
    """A centralized function to run external commands and log their output."""
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
    """Centralized exception handling for download threads."""
    error_message = f"Error in {task_name}: {e}"
    logging.error(f"[{job_id}] {error_message}", exc_info=True)
    update_job_status(job_id, "failed", message=f"Failed: An error occurred in {task_name}.", error_detail=str(e))

# --- Task Functions (run in separate threads) ---
def _process_single_mp3_task(job_id, url, cookieFileContent):
    """Target function for the single MP3 download thread."""
    try:
        job_tmp_dir = jobs.get(job_id, {}).get("job_tmp_dir")
        if not job_tmp_dir: raise Exception("Job temporary directory not found.")
        update_job_status(job_id, "processing", message="Downloading audio...")
        
        output_template = os.path.join(job_tmp_dir, '%(title)s.%(ext)s')
        args = [YTDLP_PATH, '-x', '--audio-format', 'mp3', '--no-playlist', '--ffmpeg-location', FFMPEG_PATH, '-o', output_template]
        if cookieFileContent:
            cookie_file = os.path.join(job_tmp_dir, 'cookies.txt')
            with open(cookie_file, 'w', encoding='utf-8') as f: f.write(cookieFileContent)
            args.extend(['--cookies', cookie_file])
        args.extend(['--', url])
        
        process = run_subprocess(job_id, args, 600)
        
        mp3_file = next((f for f in os.listdir(job_tmp_dir) if f.lower().endswith('.mp3')), None)
        if process.returncode != 0 or not mp3_file:
            raise Exception(f"yt-dlp failed. Exit Code: {process.returncode}. Details: {process.stderr[:500]}")
        
        update_job_status(job_id, "completed", message=f"Completed: {mp3_file}", filename=mp3_file, filepath=os.path.join(job_tmp_dir, mp3_file), jobId=job_id)
    except Exception as e:
        handle_job_exception(job_id, e, "single MP3 task")

def _process_playlist_zip_task(job_id, playlistUrl, cookieFileContent):
    """Target function for the playlist zip download thread."""
    try:
        job_tmp_dir = jobs.get(job_id, {}).get("job_tmp_dir")
        if not job_tmp_dir: raise Exception("Job temporary directory not found.")
        update_job_status(job_id, "processing", message="Downloading playlist...")

        output_template = os.path.join(job_tmp_dir, '%(playlist_index)03d - %(title)s.%(ext)s')
        args = [YTDLP_PATH, '-x', '--audio-format', 'mp3', '--yes-playlist', '--ignore-errors', '--ffmpeg-location', FFMPEG_PATH, '-o', output_template]
        if cookieFileContent:
            cookie_file = os.path.join(job_tmp_dir, 'cookies.txt')
            with open(cookie_file, 'w', encoding='utf-8') as f: f.write(cookieFileContent)
            args.extend(['--cookies', cookie_file])
        args.extend(['--', playlistUrl])

        run_subprocess(job_id, args, 1800)
        
        mp3_files = sorted([f for f in os.listdir(job_tmp_dir) if f.lower().endswith('.mp3')])
        if not mp3_files:
            raise Exception("yt-dlp process finished, but no MP3 files were created.")

        update_job_status(job_id, "processing", message=f"Zipping {len(mp3_files)} files...")
        zip_filename = sanitize_filename(f"playlist_{job_id}.zip")
        zip_path = os.path.join(job_tmp_dir, zip_filename)
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file in mp3_files:
                zipf.write(os.path.join(job_tmp_dir, file), arcname=file)

        update_job_status(job_id, "completed", message=f"Completed: {zip_filename}", filename=zip_filename, filepath=zip_path, jobId=job_id)
    except Exception as e:
        handle_job_exception(job_id, e, "playlist zip task")

def _process_combine_playlist_mp3_task(job_id, playlistUrl, cookieFileContent):
    """Target function for combining a playlist into a single MP3."""
    try:
        job_tmp_dir = jobs.get(job_id, {}).get("job_tmp_dir")
        if not job_tmp_dir: raise Exception("Job temporary directory not found.")
        
        update_job_status(job_id, "processing", message="Downloading playlist audio...")
        output_template = os.path.join(job_tmp_dir, '%(playlist_index)03d - %(title)s.%(ext)s')
        args = [YTDLP_PATH, '-x', '--audio-format', 'mp3', '--yes-playlist', '--ignore-errors', '--ffmpeg-location', FFMPEG_PATH, '-o', output_template]
        if cookieFileContent:
            cookie_file = os.path.join(job_tmp_dir, 'cookies.txt')
            with open(cookie_file, 'w', encoding='utf-8') as f: f.write(cookieFileContent)
            args.extend(['--cookies', cookie_file])
        args.extend(['--', playlistUrl])
        
        run_subprocess(job_id, args, 1800)
        
        mp3_files = sorted([os.path.join(job_tmp_dir, f) for f in os.listdir(job_tmp_dir) if f.lower().endswith('.mp3')])
        if not mp3_files:
            raise Exception("No MP3 files downloaded from the playlist.")
            
        update_job_status(job_id, "processing", message=f"Combining {len(mp3_files)} files...")
        
        concat_list_path = os.path.join(job_tmp_dir, 'concat_list.txt')
        with open(concat_list_path, 'w', encoding='utf-8') as f:
            for mp3_file in mp3_files:
                f.write(f"file '{os.path.basename(mp3_file)}'\n")
        
        combined_filename = sanitize_filename(f"combined_playlist_{job_id}.mp3")
        combined_filepath = os.path.join(job_tmp_dir, combined_filename)
        
        ffmpeg_args = [FFMPEG_PATH, '-f', 'concat', '-safe', '0', '-i', concat_list_path, '-c', 'copy', combined_filepath]
        process = run_subprocess(job_id, ffmpeg_args, 600)

        if process.returncode != 0:
            raise Exception(f"FFmpeg failed to combine files. Details: {process.stderr[:500]}")
            
        update_job_status(job_id, "completed", message=f"Combined successfully: {combined_filename}", filename=combined_filename, filepath=combined_filepath, jobId=job_id)

    except Exception as e:
        handle_job_exception(job_id, e, "combine playlist task")


# --- API Endpoints ---
def start_job(target_function, **kwargs):
    """Generic function to start any job in a new thread."""
    if not all([YTDLP_PATH, FFMPEG_PATH]):
        return jsonify({"error": "Server is not configured correctly; executables missing."}), 500
    job_id = str(uuid.uuid4())
    job_tmp_dir = tempfile.mkdtemp(prefix=f"ytlink_{job_id[:8]}_")
    with jobs_lock: jobs[job_id] = {"status": "queued", "job_tmp_dir": job_tmp_dir}
    
    thread = threading.Thread(target=target_function, args=(job_id,) + tuple(kwargs.values()), name=f"Job-{job_id[:8]}")
    thread.start()
    return jsonify({"jobId": job_id})

@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job_route():
    data = request.get_json(force=True)
    return start_job(_process_single_mp3_task, **data)

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job_route():
    data = request.get_json(force=True)
    return start_job(_process_playlist_zip_task, **data)

@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job_route():
    data = request.get_json(force=True)
    return start_job(_process_combine_playlist_mp3_task, **data)

@app.route('/job-status/<job_id>')
def get_job_status_route(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
        return jsonify(job.copy() if job else {"status": "not_found", "message": "Job not found"})

@app.route('/download-file/<job_id>/<filename>')
def download_file_route(job_id, filename):
    with jobs_lock:
        job = jobs.get(job_id, {})
        file_path = job.get("filepath")

    if not all([job.get("status") == "completed", file_path, os.path.exists(file_path)]):
        return jsonify({"error": "File not ready or not found"}), 404
        
    @after_this_request
    def cleanup(response):
        """Cleans up the job's temporary directory after the file is sent."""
        job_dir = job.get("job_tmp_dir")
        if job_dir and os.path.exists(job_dir):
            try:
                shutil.rmtree(job_dir)
                logging.info(f"[{job_id}] Cleaned up temporary directory: {job_dir}")
            except OSError as e:
                logging.error(f"[{job_id}] Error cleaning up directory {job_dir}: {e}")
        with jobs_lock:
            if job_id in jobs: del jobs[job_id]
        return response

    return send_from_directory(os.path.dirname(file_path), os.path.basename(file_path), as_attachment=True)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)
