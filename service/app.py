import os
import subprocess
import tempfile
import shutil
import logging
import zipfile
import json
import uuid # For generating unique job IDs
import threading # For background processing
from flask import Flask, request, send_file, jsonify, Response, stream_with_context, after_this_request, send_from_directory
from urllib.parse import quote
from flask_cors import CORS # Import CORS
from functools import cmp_to_key # For sorting
import re # For regex in sorting

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Check if yt-dlp exists ---
YTDLP_PATH = shutil.which("yt-dlp")
if not YTDLP_PATH:
    logging.warning("yt-dlp command not found in PATH. Ensure it's installed and accessible.")

# --- Check if ffmpeg exists ---
FFMPEG_PATH = shutil.which("ffmpeg")
if not FFMPEG_PATH:
    logging.warning("ffmpeg command not found in PATH. Combining audio/videos will likely fail.")

app = Flask(__name__)
CORS(app) # Enable CORS for all routes and origins by default

# In-memory store for job statuses and file paths
jobs = {}
jobs_lock = threading.Lock() # To make access to 'jobs' dictionary thread-safe

# --- Global Error Handler ---
@app.errorhandler(Exception)
def handle_global_exception(e):
    """
    Catches any unhandled exceptions in any route and returns a JSON response.
    """
    logging.error(f"Unhandled exception: {e}", exc_info=True) # Log the full traceback
    # For HTTPExceptions (like 404 Not Found, etc.), use its code and description
    if hasattr(e, 'code') and hasattr(e, 'description'):
        return jsonify(error=str(e.description), details=str(e)), e.code
    # For other exceptions, return a generic 500 error
    return jsonify(error="An unexpected internal server error occurred.", details=str(e)), 500

# Helper to encode filename for Content-Disposition
def sanitize_filename_header(filename):
    return quote(filename)

# Helper function to sort files based on playlist index prefix
def sort_files_by_playlist_index_comparator(a_item, b_item):
    # Assuming items are filenames like "1. Title.mp3", "10. Another.mp3"
    regex = r'^(\d+)\.'
    match_a = re.match(regex, os.path.basename(a_item)) # Use os.path.basename if full paths are passed
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
    job_tmp_dir = None
    try:
        job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_single_")
        logging.info(f"[{job_id}] Created job temporary directory: {job_tmp_dir}")
        with jobs_lock:
            jobs[job_id].update({"status": "processing_download", "job_tmp_dir": job_tmp_dir, "message": "Downloading single MP3..."})

        output_template = os.path.join(job_tmp_dir, '%(title)s.%(ext)s')
        args = [ YTDLP_PATH, '-i', '-x', '--audio-format', 'mp3', '-o', output_template, '--no-playlist' ]
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
        process = subprocess.run( args, check=False, timeout=600, capture_output=True, text=True, encoding='utf-8')
        logging.info(f"[{job_id}] yt-dlp stdout: {process.stdout}")
        if process.stderr: logging.warning(f"[{job_id}] yt-dlp stderr: {process.stderr}")

        files_in_job_dir = os.listdir(job_tmp_dir)
        mp3_file_name = next((f for f in files_in_job_dir if f.lower().endswith('.mp3') and not f == 'cookies.txt'), None)

        if mp3_file_name:
            full_mp3_path = os.path.join(job_tmp_dir, mp3_file_name)
            logging.info(f"[{job_id}] MP3 file created: {full_mp3_path}")
            with jobs_lock:
                jobs[job_id].update({"status": "completed", "filename": mp3_file_name, "filepath": full_mp3_path, "message": f"Completed: {mp3_file_name}"})
        else:
            stderr_snippet = process.stderr[:500] if process.stderr else "No MP3 files produced."
            if process.returncode != 0 and not stderr_snippet:
                 stderr_snippet = f"yt-dlp exited with code {process.returncode} but no specific error message captured."
            elif not stderr_snippet:
                 stderr_snippet = "No MP3 files produced and no specific error from yt-dlp."
            raise Exception(f"yt-dlp did not produce an MP3 file. Stderr: {stderr_snippet}")
    except Exception as e: # Catch all exceptions within the thread
        error_message = f"Error in single MP3 task: {str(e)}"
        logging.error(f"[{job_id}] {error_message}", exc_info=True)
        with jobs_lock:
            if job_id in jobs:
                 jobs[job_id].update({"status": "failed", "error": error_message, "message": f"Failed: {error_message}"})
            else: # Should not happen if job was initialized
                 logging.error(f"[{job_id}] Job entry missing when trying to report error.")


# --- Background Task for Playlist Zip ---
def _process_playlist_zip_task(job_id, playlist_url, cookie_data):
    logging.info(f"[{job_id}] Background task started for playlist zip: {playlist_url}")
    job_tmp_dir = None
    playlist_title_for_file = f"playlist_{job_id}"

    try:
        job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_zip_")
        logging.info(f"[{job_id}] Created job temporary directory for zip: {job_tmp_dir}")
        with jobs_lock:
            jobs[job_id].update({"job_tmp_dir": job_tmp_dir, "status": "processing_fetch_title", "message": "Fetching playlist title..."})

        try:
            logging.info(f"[{job_id}] Fetching playlist title for zip: {playlist_url}")
            title_args = [ YTDLP_PATH, '--flat-playlist', '--dump-single-json', '--no-warnings' ]
            cookie_file_path_title = None
            if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
                try:
                    cookie_file_path_title = os.path.join(job_tmp_dir, 'cookies_title_zip.txt')
                    with open(cookie_file_path_title, 'w', encoding='utf-8') as f: f.write(cookie_data)
                    title_args.extend(['--cookies', cookie_file_path_title])
                except Exception as e: logging.error(f"[{job_id}] Failed to write cookie file for title (zip): {e}")
            title_args.extend(['--', playlist_url])
            title_process = subprocess.run(title_args, timeout=60, capture_output=True, text=True, encoding='utf-8', check=False)
            if cookie_file_path_title and os.path.exists(cookie_file_path_title): os.remove(cookie_file_path_title)

            if title_process.returncode == 0 and title_process.stdout:
                playlist_info = json.loads(title_process.stdout)
                if isinstance(playlist_info, dict):
                    title = playlist_info.get('title') or playlist_info.get('playlist_title')
                    if title: playlist_title_for_file = title
            else:
                logging.warning(f"[{job_id}] yt-dlp title fetch for zip failed or no output. Code: {title_process.returncode}. Stderr: {title_process.stderr[:200]}")
            logging.info(f"[{job_id}] Using title for zip: {playlist_title_for_file}")
        except Exception as e:
            logging.warning(f"[{job_id}] Quick title fetch for zip failed: {e}. Using default: {playlist_title_for_file}")
            if 'cookie_file_path_title' in locals() and cookie_file_path_title and os.path.exists(cookie_file_path_title): os.remove(cookie_file_path_title)
        
        with jobs_lock:
            jobs[job_id].update({
                "playlist_title": playlist_title_for_file,
                "status": "processing_download_playlist",
                "message": f"Downloading playlist: {playlist_title_for_file}"
            })

        output_template = os.path.join(job_tmp_dir, '%(playlist_index)03d.%(title)s.%(ext)s') # Pad playlist index
        args = [ YTDLP_PATH, '-i', '-x', '--audio-format', 'mp3', '-o', output_template, '--no-warnings' ]
        cookie_file_path_dl = None
        if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
            cookie_file_path_dl = os.path.join(job_tmp_dir, 'cookies_dl.txt')
            try:
                with open(cookie_file_path_dl, 'w', encoding='utf-8') as f: f.write(cookie_data)
                logging.info(f"[{job_id}] Saved cookie data for playlist zip to: {cookie_file_path_dl}")
                args.extend(['--cookies', cookie_file_path_dl])
            except Exception as e:
                logging.error(f"[{job_id}] Failed to write cookie file for playlist zip: {e}")
        args.extend(['--', playlist_url])

        logging.info(f"[{job_id}] Running yt-dlp for playlist zip. Command: {' '.join(args)}")
        process = subprocess.run(args, check=False, timeout=1800, capture_output=True, text=True, encoding='utf-8')
        logging.info(f"[{job_id}] yt-dlp playlist zip stdout: {process.stdout}")
        if process.stderr: logging.warning(f"[{job_id}] yt-dlp playlist zip stderr: {process.stderr}")

        files_in_job_dir = os.listdir(job_tmp_dir)
        mp3_files_for_zip = [f for f in files_in_job_dir if f.lower().endswith('.mp3') and not f.startswith('cookies_')]

        if not mp3_files_for_zip:
            stderr_snippet = process.stderr[:500] if process.stderr else "No MP3 files produced."
            if process.returncode != 0 and not stderr_snippet:
                 stderr_snippet = f"yt-dlp exited with code {process.returncode} but no specific error message captured."
            elif not stderr_snippet:
                 stderr_snippet = "No MP3 files produced and no specific error from yt-dlp."
            raise Exception(f"yt-dlp did not produce any MP3 files for zipping. Stderr: {stderr_snippet}")

        with jobs_lock: jobs[job_id].update({"status": "processing_zip", "message": "Zipping playlist items..."})
        zip_filename = f"{sanitize_fs_filename(playlist_title_for_file)}.zip"
        zip_file_full_path = os.path.join(job_tmp_dir, zip_filename)

        logging.info(f"[{job_id}] Zipping {len(mp3_files_for_zip)} MP3 files into {zip_file_full_path}")
        with zipfile.ZipFile(zip_file_full_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for mp3_file in mp3_files_for_zip:
                zipf.write(os.path.join(job_tmp_dir, mp3_file), arcname=os.path.basename(mp3_file))

        logging.info(f"[{job_id}] Zip file created: {zip_file_full_path}")
        with jobs_lock:
            jobs[job_id].update({"status": "completed", "filename": zip_filename, "filepath": zip_file_full_path, "message": f"Completed: {zip_filename}"})
    except Exception as e: # Catch all exceptions within the thread
        error_message = f"Error in playlist zip task: {str(e)}"
        logging.error(f"[{job_id}] {error_message}", exc_info=True)
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"status": "failed", "error": error_message, "message": f"Failed: {error_message}"})
            else:
                logging.error(f"[{job_id}] Job entry missing when trying to report error.")


# --- Background Task for Combine Playlist to Single MP3 ---
def _process_combine_playlist_mp3_task(job_id, playlist_url, cookie_data):
    logging.info(f"[{job_id}] Background task started for combine playlist MP3: {playlist_url}")
    job_tmp_dir = None
    playlist_title = f"combined_audio_{job_id}"

    try:
        job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_combine_mp3_")
        logging.info(f"[{job_id}] Created job temporary directory for combine MP3: {job_tmp_dir}")
        with jobs_lock:
            jobs[job_id].update({"job_tmp_dir": job_tmp_dir, "status": "processing_fetch_title", "message": "Fetching playlist title..."})

        try:
            logging.info(f"[{job_id}] Fetching playlist title for combine MP3: {playlist_url}")
            title_args = [ YTDLP_PATH, '--flat-playlist', '--dump-single-json', '--no-warnings' ]
            cookie_file_path_title = None
            if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
                 try:
                     cookie_file_path_title = os.path.join(job_tmp_dir, 'cookies_title.txt')
                     with open(cookie_file_path_title, 'w', encoding='utf-8') as f: f.write(cookie_data)
                     title_args.extend(['--cookies', cookie_file_path_title])
                 except Exception as e: logging.error(f"[{job_id}] Failed to write cookie file for title: {e}")
            title_args.extend(['--', playlist_url])

            title_process = subprocess.run(title_args, check=False, timeout=60, capture_output=True, text=True, encoding='utf-8')
            if cookie_file_path_title and os.path.exists(cookie_file_path_title): os.remove(cookie_file_path_title)

            if title_process.returncode == 0 and title_process.stdout:
                playlist_info = json.loads(title_process.stdout)
                if isinstance(playlist_info, dict):
                    current_title_val = playlist_info.get('title') or playlist_info.get('playlist_title')
                    if current_title_val: playlist_title = current_title_val
            else:
                 logging.warning(f"[{job_id}] Title fetch for combine MP3 failed or returned no output. yt-dlp exit code: {title_process.returncode}. Stderr: {title_process.stderr[:200]}. Using default title: {playlist_title}")
            logging.info(f"[{job_id}] Using playlist title for combined MP3: {playlist_title}")
        except Exception as title_error:
            logging.warning(f"[{job_id}] Could not get playlist title for combine MP3: {str(title_error)}. Using default: {playlist_title}")
            if 'cookie_file_path_title' in locals() and cookie_file_path_title and os.path.exists(cookie_file_path_title): os.remove(cookie_file_path_title)
        
        with jobs_lock:
            jobs[job_id].update({
                "playlist_title": playlist_title,
                "status": "processing_download_playlist_audio",
                "message": f"Downloading audio for playlist: {playlist_title}"
            })

        output_template = os.path.join(job_tmp_dir, '%(playlist_index)03d.%(title)s.%(ext)s') # Pad playlist index
        ytdlp_audio_args = [ YTDLP_PATH, '-i', '-x', '--audio-format', 'mp3', '-o', output_template, '--no-warnings' ]
        cookie_file_path_dl = None
        if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
             try:
                 cookie_file_path_dl = os.path.join(job_tmp_dir, 'cookies_dl.txt')
                 with open(cookie_file_path_dl, 'w', encoding='utf-8') as f: f.write(cookie_data)
                 ytdlp_audio_args.extend(['--cookies', cookie_file_path_dl])
             except Exception as e:
                 logging.error(f"[{job_id}] Failed to write cookie file for audio download: {e}")
        ytdlp_audio_args.extend(['--', playlist_url])

        logging.info(f"[{job_id}] yt-dlp audio download args: {' '.join(ytdlp_audio_args)}")
        audio_process = subprocess.run(ytdlp_audio_args, check=False, timeout=3600, capture_output=True, text=True, encoding='utf-8')
        logging.info(f"[{job_id}] yt-dlp audio download stdout: {audio_process.stdout}")
        if audio_process.stderr: logging.warning(f"[{job_id}] yt-dlp audio download stderr: {audio_process.stderr}")

        files_in_job_dir = os.listdir(job_tmp_dir)
        mp3_files_to_combine = [f for f in files_in_job_dir if f.lower().endswith('.mp3') and not f.startswith('cookies_')]
        if not mp3_files_to_combine:
            stderr_snippet = audio_process.stderr[:500] if audio_process.stderr else "No MP3 files produced."
            if audio_process.returncode != 0 and not stderr_snippet:
                stderr_snippet = f"yt-dlp exited with code {audio_process.returncode} but no specific error message captured."
            elif not stderr_snippet:
                stderr_snippet = "No MP3 files produced and no specific error from yt-dlp."
            raise Exception(f"yt-dlp did not produce any MP3 files for combining. Stderr: {stderr_snippet}")

        mp3_files_to_combine.sort(key=cmp_to_key(sort_files_by_playlist_index_comparator))
        logging.info(f"[{job_id}] Found and sorted MP3 files for combining: {mp3_files_to_combine}")

        with jobs_lock: jobs[job_id].update({"status": "processing_ffmpeg_concat_mp3", "message": "Combining audio tracks..."})
        ffmpeg_list_path = os.path.join(job_tmp_dir, 'mp3_mylist.txt')
        with open(ffmpeg_list_path, 'w', encoding='utf-8') as f:
            for mp3_f in mp3_files_to_combine:
                safe_path = os.path.join(job_tmp_dir, mp3_f).replace("'", "'\\''") # Quote for ffmpeg
                f.write(f"file '{safe_path}'\n")
        logging.info(f"[{job_id}] Generated FFmpeg list for MP3s: {ffmpeg_list_path}")

        final_mp3_filename = f"{sanitize_fs_filename(playlist_title)}.mp3"
        final_mp3_full_path = os.path.join(job_tmp_dir, final_mp3_filename)
        ffmpeg_args = [ FFMPEG_PATH, '-f', 'concat', '-safe', '0', '-i', ffmpeg_list_path, '-c', 'copy', final_mp3_full_path ]
        logging.info(f"[{job_id}] Running ffmpeg command for MP3 concat: {' '.join(ffmpeg_args)}")
        ffmpeg_process = subprocess.run(ffmpeg_args, check=True, timeout=1800, capture_output=True, text=True, encoding='utf-8')
        logging.info(f"[{job_id}] ffmpeg MP3 concat stdout: {ffmpeg_process.stdout}")
        if ffmpeg_process.stderr: logging.warning(f"[{job_id}] ffmpeg MP3 concat stderr: {ffmpeg_process.stderr}")

        logging.info(f"[{job_id}] FFmpeg finished. Combined MP3 at: {final_mp3_full_path}")
        with jobs_lock:
            jobs[job_id].update({"status": "completed", "filename": final_mp3_filename, "filepath": final_mp3_full_path, "message": f"Completed: {final_mp3_filename}"})
    except Exception as e: # Catch all exceptions within the thread
        error_message = f"Error in combine playlist MP3 task: {str(e)}"
        logging.error(f"[{job_id}] {error_message}", exc_info=True)
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"status": "failed", "error": error_message, "message": f"Failed: {error_message}"})
            else:
                logging.error(f"[{job_id}] Job entry missing when trying to report error.")


# --- "Start Job" Endpoints ---
@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    json_data = request.get_json(silent=True)
    if not json_data: return jsonify({"error": "Invalid JSON request body"}), 400
    url = json_data.get('url')
    cookie_data = json_data.get('cookieData')
    if not url: return jsonify({"error": "No URL provided"}), 400
    if not YTDLP_PATH: return jsonify({"error": "Server configuration error: yt-dlp not found."}), 500
    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {"status": "queued", "url": url, "type": "single_mp3", "message": "Job queued for single MP3."}
    thread = threading.Thread(target=_process_single_mp3_task, args=(job_id, url, cookie_data))
    thread.start()
    logging.info(f"Queued job {job_id} for single MP3: {url}")
    return jsonify({"message": "Job queued successfully.", "jobId": job_id}), 202

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    json_data = request.get_json(silent=True)
    if not json_data: return jsonify({"error": "Invalid JSON request body"}), 400
    playlist_url = json_data.get('playlistUrl')
    cookie_data = json_data.get('cookieData')
    if not playlist_url: return jsonify({"error": "No playlist URL provided"}), 400
    if not YTDLP_PATH: return jsonify({"error": "Server configuration error: yt-dlp not found."}), 500

    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {
            "status": "queued",
            "playlist_url": playlist_url,
            "type": "playlist_zip",
            "playlist_title": f"playlist_{job_id}", # Default, updated by thread
            "message": "Job queued for playlist zip."
        }
    thread = threading.Thread(target=_process_playlist_zip_task, args=(job_id, playlist_url, cookie_data))
    thread.start()
    logging.info(f"Queued job {job_id} for playlist zip: {playlist_url}")
    return jsonify({"message": "Job queued successfully.", "jobId": job_id}), 202

@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job():
    json_data = request.get_json(silent=True)
    if not json_data: return jsonify({"error": "Invalid JSON request body"}), 400
    playlist_url = json_data.get('playlistUrl')
    cookie_data = json_data.get('cookieData')
    if not playlist_url: return jsonify({"error": "No playlist URL provided"}), 400
    if not YTDLP_PATH: return jsonify({"error": "Server configuration error: yt-dlp not found."}), 500
    if not FFMPEG_PATH: return jsonify({"error": "Server configuration error: ffmpeg not found."}), 500

    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {
            "status": "queued",
            "playlist_url": playlist_url,
            "type": "combine_playlist_mp3",
            "playlist_title": f"combined_audio_{job_id}", # Default, updated by thread
            "message": "Job queued for combining playlist to MP3."
        }
    thread = threading.Thread(target=_process_combine_playlist_mp3_task, args=(job_id, playlist_url, cookie_data))
    thread.start()
    logging.info(f"Queued job {job_id} for combine playlist MP3: {playlist_url}")
    return jsonify({"message": "Job queued successfully.", "jobId": job_id}), 202


# --- Job Status and Download Endpoints ---
@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status_route(job_id): # Renamed to avoid conflict with any variable named get_job_status
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "Job not found", "jobId": job_id, "status": "not_found"}), 404
        # Create a copy to avoid issues with modifying the job dict while iterating/sending
        job_details = job.copy()

    # Ensure essential fields are present
    response_data = {
        "jobId": job_id,
        "status": job_details.get("status", "unknown"),
        "message": job_details.get("message", f"Status: {job_details.get('status', 'unknown')}")
    }

    if job_details.get("status") == "completed":
        response_data["filename"] = job_details.get("filename")
        response_data["downloadUrl"] = f"/download-file/{job_id}/{sanitize_filename_header(job_details.get('filename', 'file'))}"
    elif job_details.get("status") == "failed":
        response_data["error"] = job_details.get("error", "Unknown error")
    
    return jsonify(response_data), 200

@app.route('/download-file/<job_id>/<requested_filename_from_url>', methods=['GET'])
def download_processed_file(job_id, requested_filename_from_url):
    logging.info(f"Download request for job {job_id}, URL filename {requested_filename_from_url}")
    job_tmp_dir_to_clean = None
    
    with jobs_lock: job_copy = jobs.get(job_id, {}).copy() # Get a copy

    if not job_copy:
        logging.error(f"[{job_id}] Job not found for download.")
        return jsonify({"error": "Job not found"}), 404
        
    job_status = job_copy.get("status")
    actual_filename_on_disk = job_copy.get("filename")
    file_full_path_on_disk = job_copy.get("filepath")
    job_tmp_dir_to_clean = job_copy.get("job_tmp_dir")

    if job_status != "completed" or not file_full_path_on_disk or not actual_filename_on_disk:
        logging.warning(f"[{job_id}] Job not ready for download or critical info missing. Status: {job_status}, Filepath: {file_full_path_on_disk}, Filename: {actual_filename_on_disk}")
        return jsonify({"error": "Job not completed or file information is missing"}), 404

    if not os.path.exists(file_full_path_on_disk):
        logging.error(f"File not found on disk for job {job_id}: {file_full_path_on_disk}")
        if job_tmp_dir_to_clean and os.path.exists(job_tmp_dir_to_clean):
            logging.info(f"[{job_id}] Cleaning up job temporary directory as file is missing: {job_tmp_dir_to_clean}")
            shutil.rmtree(job_tmp_dir_to_clean)
        with jobs_lock:
            if job_id in jobs: # Update original job entry
                jobs[job_id]["status"] = "failed"
                jobs[job_id]["error"] = "Downloaded file was missing on server."
                jobs[job_id]["message"] = "Failed: Downloaded file was missing on server."
        return jsonify({"error": "File not found on server, job marked as failed."}), 404

    @after_this_request
    def cleanup_job_directory(response):
        try:
            if job_tmp_dir_to_clean and os.path.exists(job_tmp_dir_to_clean):
                logging.info(f"[{job_id}] Cleaning up job temporary directory after successful download: {job_tmp_dir_to_clean}")
                shutil.rmtree(job_tmp_dir_to_clean)
            with jobs_lock:
                if job_id in jobs:
                    del jobs[job_id]
                    logging.info(f"[{job_id}] Removed job entry from memory after download.")
        except Exception as e: logging.error(f"[{job_id}] Error during job directory cleanup: {e}")
        return response

    logging.info(f"Sending file: {actual_filename_on_disk} from directory: {os.path.dirname(file_full_path_on_disk)}")
    
    try:
        return send_from_directory(
            os.path.dirname(file_full_path_on_disk),
            os.path.basename(file_full_path_on_disk),
            as_attachment=True,
            download_name=actual_filename_on_disk # Use the actual filename for the download_name suggestion
        )
    except Exception as e:
        logging.error(f"[{job_id}] Error sending file {actual_filename_on_disk}: {e}", exc_info=True)
        return jsonify({"error": "Could not send file"}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False) # Ensure debug is False for production
