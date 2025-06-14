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

# --- Helper to find bundled executables (for PyInstaller) ---
def find_executable(name):
    """
    Finds an executable, accounting for being bundled by PyInstaller.
    """
    # Check if the application is running in a bundled PyInstaller environment
    if getattr(sys, 'frozen', False):
        # The base path is the directory of the executable itself
        base_path = os.path.dirname(sys.executable)
        # On Windows, executables have a .exe extension
        exe_name = f"{name}.exe" if sys.platform == "win32" else name
        exe_path = os.path.join(base_path, exe_name)
        if os.path.exists(exe_path):
            return exe_path
    
    # If not bundled, or if not found in the bundle, search the system's PATH
    return shutil.which(name)

# --- Find and verify required executables ---
YTDLP_PATH = find_executable("yt-dlp")
if not YTDLP_PATH:
    logging.error("CRITICAL ERROR: yt-dlp executable not found.")
else:
    logging.info(f"Using yt-dlp at: {YTDLP_PATH}")
    try:
        version_process = subprocess.run([YTDLP_PATH, '--version'], capture_output=True, text=True, check=True, timeout=10)
        logging.info(f"Initial yt-dlp version: {version_process.stdout.strip()}")
    except Exception as e:
        logging.error(f"Could not determine initial yt-dlp version: {e}")

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

# (The rest of your app.py file remains the same)
# ... all your helper functions and routes ...

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
        logging.info(f"[{job_id}] Created job temporary directory: {job_tmp_dir}")
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

# --- Background Task for Playlist Zip ---
def _process_playlist_zip_task(job_id, playlist_url, cookie_data):
    logging.info(f"[{job_id}] Background task started for playlist zip: {playlist_url}")
    if not YTDLP_PATH:
        with jobs_lock:
            jobs[job_id].update({"status": "failed", "error": "Server misconfiguration: yt-dlp path is not set."})
        return

    job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_zip_")
    playlist_title_for_file = f"playlist_{job_id}"

    try:
        # Fetch title...
        with jobs_lock:
            jobs[job_id].update({"job_tmp_dir": job_tmp_dir, "status": "processing_download_playlist", "message": f"Downloading playlist..."})

        output_template = os.path.join(job_tmp_dir, '%(playlist_index)03d.%(title)s.%(ext)s')
        args = [ YTDLP_PATH, '-i', '-x', '--audio-format', 'mp3', '-o', output_template, '--no-warnings', '--verbose' ]
        if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
            cookie_file_path_dl = os.path.join(job_tmp_dir, 'cookies_dl.txt')
            with open(cookie_file_path_dl, 'w', encoding='utf-8') as f: f.write(cookie_data)
            args.extend(['--cookies', cookie_file_path_dl])
        args.extend(['--', playlist_url])

        process = subprocess.run(args, check=False, timeout=1800, capture_output=True, text=True, encoding='utf-8', errors='replace')
        # ... process results and zip ...
        mp3_files_for_zip = [f for f in os.listdir(job_tmp_dir) if f.lower().endswith('.mp3')]
        if not mp3_files_for_zip:
            raise Exception("yt-dlp did not produce any MP3 files for zipping.")

        with jobs_lock:
            jobs[job_id].update({"status": "processing_zip", "message": "Zipping playlist items..."})
            
        zip_filename = f"{sanitize_fs_filename(playlist_title_for_file)}.zip"
        zip_file_full_path = os.path.join(job_tmp_dir, zip_filename)

        with zipfile.ZipFile(zip_file_full_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for mp3_file in mp3_files_for_zip:
                zipf.write(os.path.join(job_tmp_dir, mp3_file), arcname=os.path.basename(mp3_file))

        with jobs_lock:
            jobs[job_id].update({"status": "completed", "filename": zip_filename, "filepath": zip_file_full_path, "message": f"Completed: {zip_filename}"})
    except Exception as e:
        error_message = f"Error in playlist zip task: {str(e)}"
        logging.error(f"[{job_id}] {error_message}", exc_info=True)
        with jobs_lock:
            jobs[job_id].update({"status": "failed", "error": error_message, "message": f"Failed: {error_message}"})

# --- Background Task for Combine Playlist to Single MP3 ---
def _process_combine_playlist_mp3_task(job_id, playlist_url, cookie_data):
    logging.info(f"[{job_id}] Background task started for combine playlist MP3: {playlist_url}")
    if not YTDLP_PATH or not FFMPEG_PATH:
        with jobs_lock:
            jobs[job_id].update({"status": "failed", "error": "Server misconfiguration: yt-dlp or ffmpeg path is not set."})
        return

    job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_combine_mp3_")
    playlist_title = f"combined_audio_{job_id}"
    
    try:
        # ... download audio tracks ...
        with jobs_lock:
            jobs[job_id].update({"job_tmp_dir": job_tmp_dir, "status": "processing_download_playlist_audio", "message": "Downloading audio..."})
            
        output_template = os.path.join(job_tmp_dir, '%(playlist_index)03d.%(title)s.%(ext)s')
        ffmpeg_pp_args = ["ffmpeg_o:-ar", "48000", "ffmpeg_o:-q:a", "3"]
        ytdlp_audio_args = [YTDLP_PATH, '-i', '-x', '--audio-format', 'mp3', '-o', output_template, '--no-warnings', '--verbose', '--postprocessor-args', ' '.join(ffmpeg_pp_args)]
        
        if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
             cookie_file_path_dl = os.path.join(job_tmp_dir, 'cookies_dl.txt')
             with open(cookie_file_path_dl, 'w', encoding='utf-8') as f: f.write(cookie_data)
             ytdlp_audio_args.extend(['--cookies', cookie_file_path_dl])
        ytdlp_audio_args.extend(['--', playlist_url])

        subprocess.run(ytdlp_audio_args, check=True, timeout=3600, capture_output=True, text=True, encoding='utf-8', errors='replace')
        
        mp3_files_to_combine = sorted([f for f in os.listdir(job_tmp_dir) if f.lower().endswith('.mp3')])
        if not mp3_files_to_combine:
            raise Exception("yt-dlp did not produce any MP3 files for combining.")
        
        # ... combine tracks with ffmpeg ...
        with jobs_lock:
            jobs[job_id].update({"status": "processing_ffmpeg_concat_mp3", "message": "Combining audio tracks..."})
            
        ffmpeg_list_path = os.path.join(job_tmp_dir, 'mp3_mylist.txt')
        with open(ffmpeg_list_path, 'w', encoding='utf-8') as f:
            for mp3_f in mp3_files_to_combine:
                escaped_path = os.path.join(job_tmp_dir, mp3_f).replace("'", "'\\''")
                f.write(f"file '{escaped_path}'\n")
        
        final_mp3_filename = f"{sanitize_fs_filename(playlist_title)}.mp3"
        final_mp3_full_path = os.path.join(job_tmp_dir, final_mp3_filename)
        ffmpeg_args = [FFMPEG_PATH, '-f', 'concat', '-safe', '0', '-i', ffmpeg_list_path, '-c:a', 'libmp3lame', '-q:a', '2', final_mp3_full_path]
        
        subprocess.run(ffmpeg_args, check=True, timeout=1800, capture_output=True, text=True, encoding='utf-8', errors='replace')

        with jobs_lock:
            jobs[job_id].update({"status": "completed", "filename": final_mp3_filename, "filepath": final_mp3_full_path, "message": f"Completed: {final_mp3_filename}"})
    except Exception as e:
        error_message = f"Error in combine playlist MP3 task: {str(e)}"
        logging.error(f"[{job_id}] {error_message}", exc_info=True)
        with jobs_lock:
            jobs[job_id].update({"status": "failed", "error": error_message, "message": f"Failed: {error_message}"})

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

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    json_data = request.get_json()
    playlist_url = json_data.get('playlistUrl')
    if not YTDLP_PATH: return jsonify({"error": "Server configuration error: yt-dlp not found."}), 500
    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {"status": "queued"}
    thread = threading.Thread(target=_process_playlist_zip_task, args=(job_id, playlist_url, json_data.get('cookieData')))
    thread.start()
    return jsonify({"jobId": job_id}), 202

@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job():
    json_data = request.get_json()
    playlist_url = json_data.get('playlistUrl')
    if not YTDLP_PATH or not FFMPEG_PATH: return jsonify({"error": "Server configuration error: yt-dlp or ffmpeg not found."}), 500
    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {"status": "queued"}
    thread = threading.Thread(target=_process_combine_playlist_mp3_task, args=(job_id, playlist_url, json_data.get('cookieData')))
    thread.start()
    return jsonify({"jobId": job_id}), 202

# --- Job Status and Download Endpoints ---
@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status_route(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        # Return a copy of the job details
        return jsonify(job.copy())

@app.route('/download-file/<job_id>/<filename>', methods=['GET'])
def download_processed_file(job_id, filename):
    with jobs_lock: 
        job = jobs.get(job_id, {})
    
    if not job.get("filepath") or not os.path.exists(job.get("filepath")):
        return jsonify({"error": "File not found or job invalid"}), 404
    
    job_tmp_dir_to_clean = job.get("job_tmp_dir")
    
    @after_this_request
    def cleanup(response):
        if job_tmp_dir_to_clean and os.path.exists(job_tmp_dir_to_clean):
            shutil.rmtree(job_tmp_dir_to_clean)
        with jobs_lock:
            if job_id in jobs:
                del jobs[job_id]
        return response
        
    return send_from_directory(
        directory=os.path.dirname(job.get("filepath")),
        path=os.path.basename(job.get("filepath")),
        as_attachment=True,
        download_name=job.get("filename") 
    )

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)
