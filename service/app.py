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
from flask import Flask, request, jsonify, send_file, after_this_request
from flask_cors import CORS
from yt_dlp import YoutubeDL

# --- Basic Setup ---
# Configure logging to be extremely verbose.
logging.basicConfig(level=logging.DEBUG, format='[PYTHON] %(asctime)s - %(levelname)s - %(message)s')

# --- Custom Logger for yt-dlp ---
class YtdlpLogger:
    def debug(self, msg):
        # Prepend yt-dlp's debug messages for clarity.
        if msg.startswith('[debug] '):
            logging.debug(f"YTDLP_TRACE: {msg}")
        else:
            self.info(msg)

    def info(self, msg):
        logging.info(f"YTDLP_INFO: {msg}")

    def warning(self, msg):
        logging.warning(f"YTDLP_WARN: {msg}")

    def error(self, msg):
        logging.error(f"YTDLP_ERROR: {msg}")

# Log all environment variables received from Electron at the very start.
logging.debug("--- Python Backend Starting ---")
logging.debug(f"Full environment variables received: {json.dumps(dict(os.environ), indent=2)}")

APP_PORT = int(os.environ.get('YT_LINK_BACKEND_PORT', 5001))
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})
jobs = {}
cleanup_queue = Queue()

# --- Core Helper Functions with Intense Logging ---

def set_executable_permission(path):
    if sys.platform != "win32":
        try:
            logging.debug(f"Attempting to set executable permission on: {path}")
            os.chmod(path, 0o755)
            logging.debug(f"Successfully set executable permission for {path}")
        except Exception as e:
            logging.error(f"Failed to set executable permission for {path}: {e}", exc_info=True)

def find_executable(name):
    logging.debug(f"--- Finding executable: '{name}' ---")
    resources_path = os.environ.get('YT_LINK_RESOURCES_PATH')
    logging.debug(f"Read 'YT_LINK_RESOURCES_PATH' from environment: '{resources_path}'")
    
    if resources_path and os.path.exists(resources_path):
        bin_dir = os.path.join(resources_path, 'bin')
        exe_name = f"{name}.exe" if sys.platform == "win32" else name
        exe_path = os.path.join(bin_dir, exe_name)
        logging.debug(f"Constructed bundled executable path: '{exe_path}'")
        
        if os.path.exists(exe_path):
            logging.debug(f"'{exe_path}' exists. Setting permissions.")
            set_executable_permission(exe_path)
            logging.debug(f"--- Successfully found '{name}' at '{exe_path}' ---")
            return exe_path
        else:
            logging.error(f"CRITICAL: Bundled executable does NOT exist at '{exe_path}'")
            return None
    else:
        logging.error(f"CRITICAL: 'YT_LINK_RESOURCES_PATH' is missing or path does not exist.")
        return None

def get_ydl_options(output_path, playlist=False):
    logging.debug("--- Getting yt-dlp options ---")
    ffmpeg_exe_path = find_executable('ffmpeg')
    find_executable('ffprobe')  # Also ensure ffprobe permissions are set.

    ffmpeg_dir = os.path.dirname(ffmpeg_exe_path) if ffmpeg_exe_path else None
    logging.debug(f"Final ffmpeg directory for yt-dlp: '{ffmpeg_dir}'")

    return {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
        }],
        'outtmpl': {'default': os.path.join(output_path, '%(title)s.%(ext)s')},
        'noplaylist': not playlist,
        'ffmpeg_location': ffmpeg_dir,
        'nocheckcertificate': True,
        # Use our custom logger to capture everything from yt-dlp
        'logger': YtdlpLogger(),
        'progress_hooks': [],
        # Enable verbose output from yt-dlp for maximum debugging.
        'verbose': True, 
    }

def create_job(target_function, *args):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'pending', 'progress': 0, 'message': 'Job is queued.'}
    thread = threading.Thread(target=target_function, args=(job_id,) + args)
    thread.daemon = True
    thread.start()
    return job_id

# --- Target Job Functions (simplified for brevity, logic is the same) ---
def do_download_single_mp3(job_id, url, download_path):
    jobs[job_id]['status'] = 'running'
    jobs[job_id]['message'] = 'Preparing to download...'
    os.makedirs(download_path, exist_ok=True)
    
    try:
        ydl_opts = get_ydl_options(download_path, playlist=False)
        with YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=True)
            base, _ = os.path.splitext(ydl.prepare_filename(info_dict))
            final_mp3_path = base + '.mp3'
            
            if os.path.exists(final_mp3_path):
                 jobs[job_id].update({'status': 'completed', 'message': 'MP3 created.', 'result': final_mp3_path})
            else:
                raise Exception("Conversion failed. Final MP3 not found.")
    except Exception as e:
        logging.error(f"Job {job_id} failed: {e}", exc_info=True)
        jobs[job_id].update({'status': 'failed', 'message': f"Error: {e}"})

# ... The rest of the file (do_download_and_zip_playlist, API endpoints, etc.) remains the same ...
# The code below is identical to the last version and is included for completeness.
def do_download_and_zip_playlist(job_id, url, download_path):
    jobs[job_id]['status'] = 'running'
    jobs[job_id]['message'] = 'Preparing to download playlist...'
    temp_dir = os.path.join(download_path, job_id)
    os.makedirs(temp_dir, exist_ok=True)
    try:
        ydl_opts = get_ydl_options(temp_dir, playlist=True)
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        jobs[job_id]['message'] = 'Download complete. Zipping files...'
        info_dict = YoutubeDL({'quiet': True, 'extract_flat': True}).extract_info(url, download=False)
        playlist_title = info_dict.get('title', 'playlist').replace(" ", "_")
        zip_filepath = os.path.join(download_path, f"{playlist_title}.zip")
        with zipfile.ZipFile(zip_filepath, 'w') as zipf:
            for root, _, files in os.walk(temp_dir):
                for file in files:
                    if file.endswith('.mp3'):
                        zipf.write(os.path.join(root, file), arcname=file)
        jobs[job_id].update({'status': 'completed', 'message': 'Playlist zipped.', 'result': zip_filepath})
    except Exception as e:
        logging.error(f"Job {job_id} failed: {e}", exc_info=True)
        jobs[job_id].update({'status': 'failed', 'message': str(e)})
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

@app.route('/api/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    data = request.json
    return jsonify({'jobId': create_job(do_download_single_mp3, data['url'], data['downloadPath'])})

@app.route('/api/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    data = request.json
    return jsonify({'jobId': create_job(do_download_and_zip_playlist, data['url'], data['downloadPath'])})

@app.route('/api/job-status/<job_id>', methods=['GET'])
def get_job_status(job_id):
    return jsonify(jobs.get(job_id, {'error': 'Job not found'}))

@app.route('/api/download/<job_id>', methods=['GET'])
def download_result(job_id):
    job = jobs.get(job_id)
    if not job or job.get('status') != 'completed':
        return jsonify({'error': 'Job not ready'}), 404
    file_path = job['result']
    if not os.path.exists(file_path):
        return jsonify({'error': 'File not found'}), 404
    @after_this_request
    def cleanup(response):
        if file_path.endswith('.zip'):
            cleanup_queue.put(file_path)
        return response
    return send_file(file_path, as_attachment=True)

def cleanup_worker():
    while True:
        try:
            filepath = cleanup_queue.get(timeout=1)
            os.remove(filepath)
        except Empty:
            continue
        except Exception as e:
            logging.error(f"Cleanup error: {e}")

if __name__ == '__main__':
    threading.Thread(target=cleanup_worker, daemon=True).start()
    logging.info(f"--- Starting Flask server on port {APP_PORT} ---")
    app.run(port=APP_PORT)

