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
else:
    # Log the global yt-dlp version at startup
    try:
        version_process = subprocess.run(
            [YTDLP_PATH, '--version'],
            capture_output=True,
            text=True,
            check=True,
            timeout=10
        )
        startup_ytdlp_version = version_process.stdout.strip()
        logging.info(f"Initial yt-dlp version found in PATH: {startup_ytdlp_version}")
    except Exception as e:
        logging.error(f"Could not determine initial yt-dlp version: {e}")


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
    job_id_in_context = getattr(request, 'job_id_in_context', None) # For context if set
    log_prefix = f"[{job_id_in_context}] " if job_id_in_context else ""
    logging.error(f"{log_prefix}Unhandled exception: {e}", exc_info=True) # Log the full traceback
    
    # For HTTPExceptions (like 404 Not Found, etc.), use its code and description
    # Werkzeug exceptions are part of 'e' directly.
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return jsonify(error=str(e.name), details=str(e.description)), e.code
    
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
    
    # --- ADD THIS SECTION TO LOG yt-dlp VERSION ---
    if YTDLP_PATH:
        try:
            version_process = subprocess.run(
                [YTDLP_PATH, '--version'],
                capture_output=True,
                text=True,
                check=True, # Will raise CalledProcessError if yt-dlp --version fails
                timeout=10 
            )
            actual_ytdlp_version = version_process.stdout.strip()
            logging.info(f"[{job_id}] Task using yt-dlp version: {actual_ytdlp_version}")
        except subprocess.CalledProcessError as cpe:
            logging.error(f"[{job_id}] yt-dlp --version command failed with exit code {cpe.returncode}. Stderr: {cpe.stderr.strip()}. Stdout: {cpe.stdout.strip()}")
        except subprocess.TimeoutExpired:
            logging.error(f"[{job_id}] Timeout trying to get yt-dlp version.")
        except Exception as e:
            logging.error(f"[{job_id}] Could not determine yt-dlp version for task: {e}")
    else:
        logging.error(f"[{job_id}] YTDLP_PATH not defined, cannot check yt-dlp version for task.")
    # --- END OF ADDED SECTION ---

    job_tmp_dir = None
    try:
        job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_single_")
        logging.info(f"[{job_id}] Created job temporary directory: {job_tmp_dir}")
        with jobs_lock:
            # Ensure job_id exists before updating
            if job_id in jobs:
                jobs[job_id].update({"status": "processing_download", "job_tmp_dir": job_tmp_dir, "message": "Downloading single MP3..."})
            else:
                logging.warning(f"[{job_id}] Job ID not found in jobs dict at start of processing_download for single MP3.")
                # Potentially re-initialize job entry or handle error
                return # Exit if job context is lost

        output_template = os.path.join(job_tmp_dir, '%(title)s.%(ext)s')
        # Added --no-warnings to reduce log clutter from yt-dlp itself for common warnings
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
        # Using text=True and encoding for better cross-platform compatibility with stdout/stderr
        process = subprocess.run( args, check=False, timeout=600, capture_output=True, text=True, encoding='utf-8', errors='replace')
        
        # Log verbose output from yt-dlp
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
            stderr_snippet = process.stderr[:1000] if process.stderr else "No MP3 files produced by yt-dlp." # Increased snippet size
            if process.returncode != 0 and not stderr_snippet.strip(): # If return code is non-zero but stderr is empty
                 stderr_snippet = f"yt-dlp exited with code {process.returncode} but no specific error message captured in stderr."
            elif not stderr_snippet.strip(): # No error code, but no file and empty stderr
                 stderr_snippet = "No MP3 files produced and no specific error from yt-dlp in stderr."
            raise Exception(f"yt-dlp did not produce an MP3 file. Exit code: {process.returncode}. Stderr snippet: {stderr_snippet}")
    except subprocess.TimeoutExpired:
        error_message = "Error in single MP3 task: Processing timed out during download/conversion."
        logging.error(f"[{job_id}] {error_message}", exc_info=False) # No need for full traceback for timeout
        with jobs_lock:
            if job_id in jobs:
                 jobs[job_id].update({"status": "failed", "error": error_message, "message": "Failed: Processing timed out."})
    except Exception as e: # Catch all other exceptions within the thread
        # Check if the exception is due to yt-dlp's non-zero exit but file not found
        # This is now handled by the specific raise Exception above for clarity.
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
    # --- ADD THIS SECTION TO LOG yt-dlp VERSION ---
    if YTDLP_PATH:
        try:
            version_process = subprocess.run([YTDLP_PATH, '--version'], capture_output=True, text=True, check=True, timeout=10)
            actual_ytdlp_version = version_process.stdout.strip()
            logging.info(f"[{job_id}] Task using yt-dlp version: {actual_ytdlp_version}")
        except Exception as e: logging.error(f"[{job_id}] Could not determine yt-dlp version for task: {e}")
    # --- END OF ADDED SECTION ---
    job_tmp_dir = None
    playlist_title_for_file = f"playlist_{job_id}"

    try:
        job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_zip_")
        logging.info(f"[{job_id}] Created job temporary directory for zip: {job_tmp_dir}")
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"job_tmp_dir": job_tmp_dir, "status": "processing_fetch_title", "message": "Fetching playlist title..."})
            else: return # Exit if job context is lost

        try:
            logging.info(f"[{job_id}] Fetching playlist title for zip: {playlist_url}")
            title_args = [ YTDLP_PATH, '--flat-playlist', '--dump-single-json', '--no-warnings', '--verbose' ]
            cookie_file_path_title = None
            if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
                try:
                    cookie_file_path_title = os.path.join(job_tmp_dir, 'cookies_title_zip.txt')
                    with open(cookie_file_path_title, 'w', encoding='utf-8') as f: f.write(cookie_data)
                    title_args.extend(['--cookies', cookie_file_path_title])
                except Exception as e: logging.error(f"[{job_id}] Failed to write cookie file for title (zip): {e}")
            title_args.extend(['--', playlist_url])
            title_process = subprocess.run(title_args, timeout=60, capture_output=True, text=True, encoding='utf-8', errors='replace', check=False)
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
            logging.warning(f"[{job_id}] Quick title fetch for zip failed: {e}. Using default: {playlist_title_for_file}", exc_info=True)
            if 'cookie_file_path_title' in locals() and cookie_file_path_title and os.path.exists(cookie_file_path_title): os.remove(cookie_file_path_title)
        
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({
                    "playlist_title": playlist_title_for_file,
                    "status": "processing_download_playlist",
                    "message": f"Downloading playlist: {playlist_title_for_file}"
                })
            else: return

        output_template = os.path.join(job_tmp_dir, '%(playlist_index)03d.%(title)s.%(ext)s')
        args = [ YTDLP_PATH, '-i', '-x', '--audio-format', 'mp3', '-o', output_template, '--no-warnings', '--verbose' ]
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
        process = subprocess.run(args, check=False, timeout=1800, capture_output=True, text=True, encoding='utf-8', errors='replace')
        logging.info(f"[{job_id}] yt-dlp playlist zip full stdout:\n{process.stdout}")
        if process.stderr: logging.warning(f"[{job_id}] yt-dlp playlist zip full stderr:\n{process.stderr}")

        files_in_job_dir = os.listdir(job_tmp_dir)
        mp3_files_for_zip = [f for f in files_in_job_dir if f.lower().endswith('.mp3') and not f.startswith('cookies_')]

        if not mp3_files_for_zip:
            stderr_snippet = process.stderr[:1000] if process.stderr else "No MP3 files produced."
            if process.returncode != 0 and not stderr_snippet.strip():
                 stderr_snippet = f"yt-dlp exited with code {process.returncode} but no specific error message captured."
            elif not stderr_snippet.strip():
                 stderr_snippet = "No MP3 files produced and no specific error from yt-dlp."
            raise Exception(f"yt-dlp did not produce any MP3 files for zipping. Exit code: {process.returncode}. Stderr: {stderr_snippet}")

        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"status": "processing_zip", "message": "Zipping playlist items..."})
            else: return
                
        zip_filename = f"{sanitize_fs_filename(playlist_title_for_file)}.zip"
        zip_file_full_path = os.path.join(job_tmp_dir, zip_filename)

        logging.info(f"[{job_id}] Zipping {len(mp3_files_for_zip)} MP3 files into {zip_file_full_path}")
        with zipfile.ZipFile(zip_file_full_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for mp3_file in mp3_files_for_zip:
                zipf.write(os.path.join(job_tmp_dir, mp3_file), arcname=os.path.basename(mp3_file))

        logging.info(f"[{job_id}] Zip file created: {zip_file_full_path}")
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"status": "completed", "filename": zip_filename, "filepath": zip_file_full_path, "message": f"Completed: {zip_filename}"})
    except subprocess.TimeoutExpired:
        error_message = "Error in playlist zip task: Processing timed out."
        logging.error(f"[{job_id}] {error_message}", exc_info=False)
        with jobs_lock:
            if job_id in jobs:
                 jobs[job_id].update({"status": "failed", "error": error_message, "message": "Failed: Processing timed out."})
    except Exception as e:
        error_message = f"Error in playlist zip task: {str(e)}"
        logging.error(f"[{job_id}] {error_message}", exc_info=True)
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"status": "failed", "error": error_message, "message": f"Failed: {error_message}"})
            else:
                logging.error(f"[{job_id}] Job entry missing when trying to report error for: {error_message}")


# --- Background Task for Combine Playlist to Single MP3 ---
def _process_combine_playlist_mp3_task(job_id, playlist_url, cookie_data):
    logging.info(f"[{job_id}] Background task started for combine playlist MP3: {playlist_url}")
    # --- ADD THIS SECTION TO LOG yt-dlp VERSION ---
    if YTDLP_PATH:
        try:
            version_process = subprocess.run([YTDLP_PATH, '--version'], capture_output=True, text=True, check=True, timeout=10)
            actual_ytdlp_version = version_process.stdout.strip()
            logging.info(f"[{job_id}] Task using yt-dlp version: {actual_ytdlp_version}")
        except Exception as e: logging.error(f"[{job_id}] Could not determine yt-dlp version for task: {e}")
    # --- END OF ADDED SECTION ---
    job_tmp_dir = None
    playlist_title = f"combined_audio_{job_id}"

    try:
        job_tmp_dir = tempfile.mkdtemp(prefix=f"{job_id}_combine_mp3_")
        logging.info(f"[{job_id}] Created job temporary directory for combine MP3: {job_tmp_dir}")
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"job_tmp_dir": job_tmp_dir, "status": "processing_fetch_title", "message": "Fetching playlist title..."})
            else: return # Exit if job context is lost

        try:
            logging.info(f"[{job_id}] Fetching playlist title for combine MP3: {playlist_url}")
            title_args = [ YTDLP_PATH, '--flat-playlist', '--dump-single-json', '--no-warnings', '--verbose' ]
            cookie_file_path_title = None
            if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
                 try:
                     cookie_file_path_title = os.path.join(job_tmp_dir, 'cookies_title.txt')
                     with open(cookie_file_path_title, 'w', encoding='utf-8') as f: f.write(cookie_data)
                     title_args.extend(['--cookies', cookie_file_path_title])
                 except Exception as e: logging.error(f"[{job_id}] Failed to write cookie file for title: {e}")
            title_args.extend(['--', playlist_url])

            title_process = subprocess.run(title_args, check=False, timeout=60, capture_output=True, text=True, encoding='utf-8', errors='replace')
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
            logging.warning(f"[{job_id}] Could not get playlist title for combine MP3: {str(title_error)}. Using default: {playlist_title}", exc_info=True)
            if 'cookie_file_path_title' in locals() and cookie_file_path_title and os.path.exists(cookie_file_path_title): os.remove(cookie_file_path_title)
        
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({
                    "playlist_title": playlist_title,
                    "status": "processing_download_playlist_audio",
                    "message": f"Downloading audio for playlist: {playlist_title}"
                })
            else: return

        output_template = os.path.join(job_tmp_dir, '%(playlist_index)03d.%(title)s.%(ext)s')
        ytdlp_audio_args = [ YTDLP_PATH, '-i', '-x', '--audio-format', 'mp3', '-o', output_template, '--no-warnings', '--verbose' ]
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
        audio_process = subprocess.run(ytdlp_audio_args, check=False, timeout=3600, capture_output=True, text=True, encoding='utf-8', errors='replace')
        logging.info(f"[{job_id}] yt-dlp audio download full stdout:\n{audio_process.stdout}")
        if audio_process.stderr: logging.warning(f"[{job_id}] yt-dlp audio download full stderr:\n{audio_process.stderr}")

        files_in_job_dir = os.listdir(job_tmp_dir)
        mp3_files_to_combine = [f for f in files_in_job_dir if f.lower().endswith('.mp3') and not f.startswith('cookies_')]
        if not mp3_files_to_combine:
            stderr_snippet = audio_process.stderr[:1000] if audio_process.stderr else "No MP3 files produced."
            if audio_process.returncode != 0 and not stderr_snippet.strip():
                stderr_snippet = f"yt-dlp exited with code {audio_process.returncode} but no specific error message captured."
            elif not stderr_snippet.strip():
                stderr_snippet = "No MP3 files produced and no specific error from yt-dlp."
            raise Exception(f"yt-dlp did not produce any MP3 files for combining. Exit code: {audio_process.returncode}. Stderr: {stderr_snippet}")

        # Ensure sorting uses the comparator correctly with cmp_to_key
        mp3_files_to_combine.sort(key=cmp_to_key(sort_files_by_playlist_index_comparator))
        logging.info(f"[{job_id}] Found and sorted MP3 files for combining: {mp3_files_to_combine}")

        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"status": "processing_ffmpeg_concat_mp3", "message": "Combining audio tracks..."})
            else: return
                
        ffmpeg_list_path = os.path.join(job_tmp_dir, 'mp3_mylist.txt')
        with open(ffmpeg_list_path, 'w', encoding='utf-8') as f:
            for mp3_f in mp3_files_to_combine:
                # Ensure paths with spaces/special chars are handled for ffmpeg's concat demuxer
                # The single quotes in 'file \'{path}\'' are for ffmpeg's parser.
                # Internal single quotes in the path itself must be escaped.
                escaped_path = os.path.join(job_tmp_dir, mp3_f).replace("'", "'\\''")
                f.write(f"file '{escaped_path}'\n")
        logging.info(f"[{job_id}] Generated FFmpeg list for MP3s: {ffmpeg_list_path}")

        final_mp3_filename = f"{sanitize_fs_filename(playlist_title)}.mp3"
        final_mp3_full_path = os.path.join(job_tmp_dir, final_mp3_filename)
        # Forcing re-encode to MP3 to ensure compatibility and fix potential issues from -c copy
        # Using -q:a 2 for high quality VBR MP3. Adjust as needed.
        ffmpeg_args = [ 
            FFMPEG_PATH, '-f', 'concat', '-safe', '0', '-i', ffmpeg_list_path, 
            '-c:a', 'libmp3lame', '-q:a', '2', # Re-encode to MP3
            final_mp3_full_path 
        ]
        logging.info(f"[{job_id}] Running ffmpeg command for MP3 concat (re-encoding): {' '.join(ffmpeg_args)}")
        ffmpeg_process = subprocess.run(ffmpeg_args, check=True, timeout=1800, capture_output=True, text=True, encoding='utf-8', errors='replace')
        logging.info(f"[{job_id}] ffmpeg MP3 concat stdout: {ffmpeg_process.stdout}")
        if ffmpeg_process.stderr: logging.warning(f"[{job_id}] ffmpeg MP3 concat stderr: {ffmpeg_process.stderr}")

        logging.info(f"[{job_id}] FFmpeg finished. Combined MP3 at: {final_mp3_full_path}")
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"status": "completed", "filename": final_mp3_filename, "filepath": final_mp3_full_path, "message": f"Completed: {final_mp3_filename}"})
    except subprocess.CalledProcessError as e:
        tool_name = "Tool"
        cmd_str = ' '.join(e.cmd) if isinstance(e.cmd, list) else str(e.cmd)
        if YTDLP_PATH and YTDLP_PATH in cmd_str: tool_name = "yt-dlp"
        elif FFMPEG_PATH and FFMPEG_PATH in cmd_str: tool_name = "ffmpeg"
        
        error_detail = f"{tool_name} execution failed. Exit code: {e.returncode}. Stdout: {e.stdout[:200] if e.stdout else ''}. Stderr: {e.stderr[:500] if e.stderr else ''}"
        logging.error(f"[{job_id}] {error_detail}", exc_info=False) # exc_info=False as we are formatting the error
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"status": "failed", "error": error_detail, "message": f"Failed: {tool_name} execution error."})
    except subprocess.TimeoutExpired:
        error_message = "Error in combine playlist MP3 task: Processing timed out."
        logging.error(f"[{job_id}] {error_message}", exc_info=False)
        with jobs_lock:
            if job_id in jobs:
                 jobs[job_id].update({"status": "failed", "error": error_message, "message": "Failed: Processing timed out."})
    except Exception as e:
        error_message = f"Error in combine playlist MP3 task: {str(e)}"
        logging.error(f"[{job_id}] {error_message}", exc_info=True)
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id].update({"status": "failed", "error": error_message, "message": f"Failed: {error_message}"})
            else:
                logging.error(f"[{job_id}] Job entry missing when trying to report error for: {error_message}")


# --- "Start Job" Endpoints ---
@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    request.job_id_in_context = "NEW_SINGLE_MP3" # For global error handler context
    json_data = request.get_json(silent=True)
    if not json_data: return jsonify({"error": "Invalid JSON request body"}), 400
    url = json_data.get('url')
    cookie_data = json_data.get('cookieData')
    if not url: return jsonify({"error": "No URL provided"}), 400
    if not YTDLP_PATH: return jsonify({"error": "Server configuration error: yt-dlp not found."}), 500
    job_id = str(uuid.uuid4())
    request.job_id_in_context = job_id # Update context
    with jobs_lock:
        jobs[job_id] = {"status": "queued", "url": url, "type": "single_mp3", "message": "Job queued for single MP3."}
    thread = threading.Thread(target=_process_single_mp3_task, args=(job_id, url, cookie_data))
    thread.start()
    logging.info(f"Queued job {job_id} for single MP3: {url}")
    return jsonify({"message": "Job queued successfully.", "jobId": job_id}), 202

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    request.job_id_in_context = "NEW_PLAYLIST_ZIP"
    json_data = request.get_json(silent=True)
    if not json_data: return jsonify({"error": "Invalid JSON request body"}), 400
    playlist_url = json_data.get('playlistUrl')
    cookie_data = json_data.get('cookieData')
    if not playlist_url: return jsonify({"error": "No playlist URL provided"}), 400
    if not YTDLP_PATH: return jsonify({"error": "Server configuration error: yt-dlp not found."}), 500

    job_id = str(uuid.uuid4())
    request.job_id_in_context = job_id
    with jobs_lock:
        jobs[job_id] = {
            "status": "queued",
            "playlist_url": playlist_url,
            "type": "playlist_zip",
            "playlist_title": f"playlist_{job_id}", 
            "message": "Job queued for playlist zip."
        }
    thread = threading.Thread(target=_process_playlist_zip_task, args=(job_id, playlist_url, cookie_data))
    thread.start()
    logging.info(f"Queued job {job_id} for playlist zip: {playlist_url}")
    return jsonify({"message": "Job queued successfully.", "jobId": job_id}), 202

@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job():
    request.job_id_in_context = "NEW_COMBINE_MP3"
    json_data = request.get_json(silent=True)
    if not json_data: return jsonify({"error": "Invalid JSON request body"}), 400
    playlist_url = json_data.get('playlistUrl')
    cookie_data = json_data.get('cookieData')
    if not playlist_url: return jsonify({"error": "No playlist URL provided"}), 400
    if not YTDLP_PATH: return jsonify({"error": "Server configuration error: yt-dlp not found."}), 500
    if not FFMPEG_PATH: return jsonify({"error": "Server configuration error: ffmpeg not found."}), 500

    job_id = str(uuid.uuid4())
    request.job_id_in_context = job_id
    with jobs_lock:
        jobs[job_id] = {
            "status": "queued",
            "playlist_url": playlist_url,
            "type": "combine_playlist_mp3",
            "playlist_title": f"combined_audio_{job_id}", 
            "message": "Job queued for combining playlist to MP3."
        }
    thread = threading.Thread(target=_process_combine_playlist_mp3_task, args=(job_id, playlist_url, cookie_data))
    thread.start()
    logging.info(f"Queued job {job_id} for combine playlist MP3: {playlist_url}")
    return jsonify({"message": "Job queued successfully.", "jobId": job_id}), 202


# --- Job Status and Download Endpoints ---
@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status_route(job_id): 
    request.job_id_in_context = job_id # For global error handler context
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "Job not found", "jobId": job_id, "status": "not_found", "message": "Job ID not found."}), 404
        job_details = job.copy() # Essential to avoid issues if job dict is modified by background thread

    # Ensure essential fields are present
    response_data = {
        "jobId": job_id,
        "status": job_details.get("status", "unknown"),
        "message": job_details.get("message", f"Status: {job_details.get('status', 'unknown')}")
    }

    if job_details.get("status") == "completed":
        response_data["filename"] = job_details.get("filename")
        # Ensure filename is not None before creating downloadUrl
        if job_details.get('filename'):
            response_data["downloadUrl"] = f"/download-file/{job_id}/{sanitize_filename_header(job_details.get('filename'))}"
        else:
            # This case should ideally not happen if status is completed
            response_data["error"] = "Completed job has no filename."
            response_data["message"] = "Error: Completed job is missing filename."
            logging.error(f"[{job_id}] Completed job is missing filename. Job details: {job_details}")

    elif job_details.get("status") == "failed":
        response_data["error"] = job_details.get("error", "Unknown error")
    
    return jsonify(response_data), 200

@app.route('/download-file/<job_id>/<requested_filename_from_url>', methods=['GET'])
def download_processed_file(job_id, requested_filename_from_url):
    request.job_id_in_context = job_id # For global error handler context
    logging.info(f"[{job_id}] Download request for job, URL filename {requested_filename_from_url}")
    job_tmp_dir_to_clean = None
    
    with jobs_lock: 
        # Get a copy to work with, to prevent modification issues if job is deleted by cleanup
        job_snapshot = jobs.get(job_id, {}).copy() 

    if not job_snapshot: # Job might have been cleaned up already
        logging.error(f"[{job_id}] Job not found for download (possibly already cleaned up or never existed).")
        return jsonify({"error": "Job not found or already processed"}), 404
        
    job_status = job_snapshot.get("status")
    actual_filename_on_disk = job_snapshot.get("filename")
    file_full_path_on_disk = job_snapshot.get("filepath")
    job_tmp_dir_to_clean = job_snapshot.get("job_tmp_dir") # Get temp dir from snapshot

    if job_status != "completed" or not file_full_path_on_disk or not actual_filename_on_disk:
        logging.warning(f"[{job_id}] Job not ready for download or critical info missing. Status: {job_status}, Filepath: {file_full_path_on_disk}, Filename: {actual_filename_on_disk}")
        # Do not clean up here as the job might still be processing or failed with a valid temp dir.
        return jsonify({"error": "Job not completed, is still processing, or file information is missing"}), 404

    if not os.path.exists(file_full_path_on_disk):
        logging.error(f"[{job_id}] File not found on disk for download: {file_full_path_on_disk}")
        # File is missing, something went wrong. Update status and attempt cleanup.
        with jobs_lock:
            if job_id in jobs: # Check if original job entry still exists
                jobs[job_id]["status"] = "failed"
                jobs[job_id]["error"] = "Downloaded file was missing on server during download attempt."
                jobs[job_id]["message"] = "Failed: Downloaded file was missing on server."
        
        # Attempt to clean up the directory if it exists
        if job_tmp_dir_to_clean and os.path.exists(job_tmp_dir_to_clean):
            try:
                logging.info(f"[{job_id}] Cleaning up job temporary directory as file is missing: {job_tmp_dir_to_clean}")
                shutil.rmtree(job_tmp_dir_to_clean)
                with jobs_lock: # Also remove from jobs dict if cleaned up
                    if job_id in jobs: del jobs[job_id]
            except Exception as e:
                logging.error(f"[{job_id}] Error during cleanup of missing file's temp directory: {e}")
        return jsonify({"error": "File not found on server, job has been marked as failed."}), 404

    @after_this_request
    def cleanup_job_directory(response):
        # Use the job_tmp_dir_to_clean captured when the download was initiated
        # This ensures we're using the correct path even if the job entry is modified/deleted later
        # The `jobs_lock` here is primarily to safely delete the job entry from the global `jobs` dict.
        if job_tmp_dir_to_clean and os.path.exists(job_tmp_dir_to_clean):
            try:
                logging.info(f"[{job_id}] Cleaning up job temporary directory after successful download transmission: {job_tmp_dir_to_clean}")
                shutil.rmtree(job_tmp_dir_to_clean)
            except Exception as e: 
                logging.error(f"[{job_id}] Error during post-download job directory cleanup: {e}")
        
        with jobs_lock:
            if job_id in jobs:
                del jobs[job_id]
                logging.info(f"[{job_id}] Removed job entry from memory after download processed.")
            else:
                logging.info(f"[{job_id}] Job entry already removed from memory prior to post-download cleanup.")
        return response

    logging.info(f"[{job_id}] Sending file: {actual_filename_on_disk} from directory: {os.path.dirname(file_full_path_on_disk)}")
    
    try:
        return send_from_directory(
            directory=os.path.dirname(file_full_path_on_disk),
            path=os.path.basename(file_full_path_on_disk), # In Flask 2.3+, 'path' is preferred over 'filename'
            as_attachment=True,
            download_name=actual_filename_on_disk 
        )
    except Exception as e:
        logging.error(f"[{job_id}] Error sending file {actual_filename_on_disk}: {e}", exc_info=True)
        # Do not delete the job here, as the file transfer failed. User might retry.
        return jsonify({"error": "Could not send file due to a server error"}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    # Set debug=False for any production or stable testing environment
    # Threaded=True is generally good for handling multiple requests with background tasks
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)