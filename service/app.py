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
        logging.info(f"[{job_id}] Created job temporary directory: {job_tmp_dir}")
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"status": "processing_download", "job_tmp_dir": job_tmp_dir, "message": "Downloading single MP3..."})
            else:
                logging.warning(f"[{job_id}] Job ID not found in jobs dict at start of processing_download for single MP3.")
                return 

        output_template = os.path.join(job_tmp_dir, '%(title)s.%(ext)s')
        args = [ YTDLP_PATH, '-i', '-x', '--audio-format', 'mp3', '-o', output_template, '--no-playlist', '--no-warnings', '--verbose' ]
        if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
            cookie_file_path = os.path.join(job_tmp_dir, 'cookies.txt')
            try:
                with open(cookie_file_path, 'w', encoding='utf-8') as f: f.write(cookie_data)
                logging.info(f"[{job_id}] Saved cookie data to: {cookie_file_path}")
                args.extend(['--cookies', cookie_file_path])
            except Exception as e:
                logging.error(f"[{job_id}] Failed to write cookie file: {e}")
        args.extend(['--', url])

        logging.info(f"[{job_id}] Running yt-dlp. Command: {' '.join(args)}")
        process = subprocess.run( args, check=False, timeout=600, capture_output=True, text=True, encoding='utf-8', errors='replace')
        
        logging.info(f"[{job_id}] yt-dlp full stdout:\n{process.stdout}")
        if process.stderr: 
            logging.warning(f"[{job_id}] yt-dlp full stderr:\n{process.stderr}")

        files_in_job_dir = os.listdir(job_tmp_dir)
        mp3_file_name = next((f for f in files_in_job_dir if f.lower().endswith('.mp3') and not f == 'cookies.txt'), None)

        if mp3_file_name:
            full_mp3_path = os.path.join(job_tmp_dir, mp3_file_name)
            logging.info(f"[{job_id}] MP3 file created: {full_mp3_path}")
            with jobs_lock:
                if job_id in jobs:
                    jobs[job_id].update({"status": "completed", "filename": mp3_file_name, "filepath": full_mp3_path, "message": f"Completed: {mp3_file_name}"})
        else:
            stderr_snippet = process.stderr[:1000] if process.stderr else "No MP3 files produced by yt-dlp." 
            if process.returncode != 0 and not stderr_snippet.strip(): 
                 stderr_snippet = f"yt-dlp exited with code {process.returncode} but no specific error message captured in stderr."
            elif not stderr_snippet.strip(): 
                 stderr_snippet = "No MP3 files produced and no specific error from yt-dlp in stderr."
            raise Exception(f"yt-dlp did not produce an MP3 file. Exit code: {process.returncode}. Stderr snippet: {stderr_snippet}")
    except subprocess.TimeoutExpired:
        error_message = "Error in single MP3 task: Processing timed out during download/conversion."
        logging.error(f"[{job_id}] {error_message}", exc_info=False) 
        with jobs_lock:
            if job_id in jobs:
                 jobs[job_id].update({"status": "failed", "error": error_message, "message": "Failed: Processing timed out."})
    except Exception as e: 
        error_message = f"Error in single MP3 task: {str(e)}"
        logging.error(f"[{job_id}] {error_message}", exc_info=True)
        with jobs_lock:
            if job_id in jobs:
                 jobs[job_id].update({"status": "failed", "error": error_message, "message": f"Failed: {error_message}"})
            else: 
                 logging.error(f"[{job_id}] Job entry missing when trying to report error for: {error_message}")

# --- Background Task for Playlist Zip ---
def _process_playlist_zip_task(job_id, playlist_url, cookie_data):
    logging.info(f"[{job_id}] Background task started for playlist zip: {playlist_url}")
    if not YTDLP_PATH:
        with jobs_lock: jobs[job_id].update({"status": "failed", "error": "Server misconfiguration: yt-dlp path is not set."}); return

    job_tmp_dir = None
    playlist_title_for_file = f"playlist_{job_id}"

    try:
        job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_zip_")
        logging.info(f"[{job_id}] Created job temporary directory for zip: {job_tmp_dir}")
        with jobs_lock:
            if job_id in jobs: jobs[job_id].update({"job_tmp_dir": job_tmp_dir, "status": "processing_fetch_title", "message": "Fetching playlist title..."});
            else: return 

        output_template = os.path.join(job_tmp_dir, '%(playlist_index)03d.%(title)s.%(ext)s')
        args = [ YTDLP_PATH, '-i', '-x', '--audio-format', 'mp3', '-o', output_template, '--no-warnings', '--verbose' ]
        if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
            cookie_file_path_dl = os.path.join(job_tmp_dir, 'cookies_dl.txt')
            with open(cookie_file_path_dl, 'w', encoding='utf-8') as f: f.write(cookie_data)
            args.extend(['--cookies', cookie_file_path_dl])
        args.extend(['--', playlist_url])

        process = subprocess.run(args, check=False, timeout=1800, capture_output=True, text=True, encoding='utf-8', errors='replace')

        mp3_files_for_zip = [f for f in os.listdir(job_tmp_dir) if f.lower().endswith('.mp3')]

        if not mp3_files_for_zip:
            raise Exception(f"yt-dlp did not produce any MP3 files for zipping. Exit code: {process.returncode}.")

        with jobs_lock:
            if job_id in jobs: jobs[job_id].update({"status": "processing_zip", "message": "Zipping playlist items..."});
            else: return
                
        zip_filename = f"{sanitize_fs_filename(playlist_title_for_file)}.zip"
        zip_file_full_path = os.path.join(job_tmp_dir, zip_filename)

        with zipfile.ZipFile(zip_file_full_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for mp3_file in mp3_files_for_zip:
                zipf.write(os.path.join(job_tmp_dir, mp3_file), arcname=os.path.basename(mp3_file))

        with jobs_lock:
            if job_id in jobs: jobs[job_id].update({"status": "completed", "filename": zip_filename, "filepath": zip_file_full_path, "message": f"Completed: {zip_filename}"})
    except Exception as e:
        error_message = f"Error in playlist zip task: {str(e)}"
        logging.error(f"[{job_id}] {error_message}", exc_info=True)
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"status": "failed", "error": error_message, "message": f"Failed: {error_message}"})

# --- Background Task for Combine Playlist to Single MP3 ---
def _process_combine_playlist_mp3_task(job_id, playlist_url, cookie_data):
    logging.info(f"[{job_id}] Background task started for combine playlist MP3: {playlist_url}")
    if not YTDLP_PATH or not FFMPEG_PATH:
        with jobs_lock: jobs[job_id].update({"status": "failed", "error": "Server misconfiguration: yt-dlp or ffmpeg not found."}); return

    job_tmp_dir = None
    playlist_title = f"combined_audio_{job_id}"

    try:
        job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_combine_mp3_")
        with jobs_lock:
            if job_id in jobs: jobs[job_id].update({"job_tmp_dir": job_tmp_dir, "status": "processing_download_playlist_audio", "message": "Downloading audio for playlist..."});
            else: return

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

        with jobs_lock:
            if job_id in jobs: jobs[job_id].update({"status": "processing_ffmpeg_concat_mp3", "message": "Combining audio tracks..."});
            else: return
                
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
            if job_id in jobs: jobs[job_id].update({"status": "completed", "filename": final_mp3_filename, "filepath": final_mp3_full_path, "message": f"Completed: {final_mp3_filename}"})
    except Exception as e:
        error_message = f"Error in combine playlist MP3 task: {str(e)}"
        logging.error(f"[{job_id}] {error_message}", exc_info=True)
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"status": "failed", "error": error_message, "message": f"Failed: {error_message}"})

# --- "Start Job" Endpoints ---
@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    json_data = request.get_json(silent=True) or {}
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
    json_data = request.get_json(silent=True) or {}
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
    json_data = request.get_json(silent=True) or {}
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
            return jsonify({"error": "Job not found", "jobId": job_id, "status": "not_found", "message": "Job ID not found."}), 404
        job_details = job.copy()
    return jsonify(job_details), 200

@app.route('/download-file/<job_id>/<requested_filename_from_url>', methods=['GET'])
def download_processed_file(job_id, requested_filename_from_url):
    job_tmp_dir_to_clean = None
    with jobs_lock: 
        job_snapshot = jobs.get(job_id, {}).copy() 

    if not job_snapshot or job_snapshot.get("status") != "completed": 
        return jsonify({"error": "Job not ready or not found"}), 404
    
    file_full_path_on_disk = job_snapshot.get("filepath")
    actual_filename_on_disk = job_snapshot.get("filename")
    job_tmp_dir_to_clean = job_snapshot.get("job_tmp_dir")

    if not file_full_path_on_disk or not os.path.exists(file_full_path_on_disk):
        return jsonify({"error": "File not found on server"}), 404

    @after_this_request
    def cleanup_job_directory(response):
        if job_tmp_dir_to_clean and os.path.exists(job_tmp_dir_to_clean):
            shutil.rmtree(job_tmp_dir_to_clean)
        with jobs_lock:
            if job_id in jobs: del jobs[job_id]
        return response

    return send_from_directory(
        directory=os.path.dirname(file_full_path_on_disk),
        path=os.path.basename(file_full_path_on_disk), 
        as_attachment=True,
        download_name=actual_filename_on_disk 
    )

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)
