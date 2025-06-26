import os
import shutil
import sys
import traceback
import threading
import time
import uuid
import zipfile
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import yt_dlp
import platform
import subprocess

# --- Absolute First Thing: Setup Indestructible Logging ---
# This setup will capture any error, even during imports or basic setup.
LOG_FILE_PATH = os.path.join(os.path.expanduser("~"), "yt_link_backend_debug.log")
ORIGINAL_STDOUT = sys.stdout
ORIGINAL_STDERR = sys.stderr

try:
    # 'w' for write to clear the log on each run.
    log_file = open(LOG_FILE_PATH, 'w', encoding='utf-8', buffering=1) # Use line buffering
    sys.stdout = log_file
    sys.stderr = log_file
    print("--- Log file initialized ---", flush=True)
except Exception as e:
    # If logging fails, we can't do much, but let's try to print to the original stderr.
    print(f"CRITICAL: Failed to initialize log file at {LOG_FILE_PATH}. Error: {e}", file=ORIGINAL_STDERR, flush=True)

# --- Main Application Logic inside a try...except block ---
# This ensures that ANY crash, at any point, is logged.
try:
    print("--- Starting main application block ---", flush=True)
    print("Importing modules...", flush=True)
    
    app = Flask(__name__)
    CORS(app)
    jobs = {}
    print("--- Module imports and app initialization successful ---", flush=True)
    
    # --- Helper Functions ---

    def get_ffmpeg_path():
        """
        Determines the correct, robust path for the FFMPEG directory.
        This is the definitive, corrected function.
        """
        print("--- DEBUG: Starting get_ffmpeg_path() ---", flush=True)
        
        # The Current Working Directory (cwd) is our reliable anchor.
        # It is set by main.js when the process is spawned.
        current_dir = os.getcwd()
        print(f"--- DEBUG: Current Working Directory (os.getcwd()): {current_dir}", flush=True)
        
        ffmpeg_dir = None
        # In a packaged app, the cwd is set by main.js to the 'backend' dir in Resources.
        if getattr(sys, 'frozen', False):
            # We navigate up one level from 'backend' to 'Resources', then into 'bin'.
            ffmpeg_dir = os.path.join(current_dir, '..', 'bin')
        # In development, the cwd is set by main.js to the project root.
        else:
            # We navigate from the project root into 'bin'.
             ffmpeg_dir = os.path.join(current_dir, 'bin')

        ffmpeg_dir = os.path.abspath(ffmpeg_dir)
        print(f"--- DEBUG: Constructed ffmpeg directory path: {ffmpeg_dir}", flush=True)
        
        if not os.path.isdir(ffmpeg_dir):
            error_message = f"FATAL: FFMPEG directory NOT FOUND at expected path: {ffmpeg_dir}"
            print(error_message, file=sys.stderr, flush=True)
            raise FileNotFoundError(error_message)
        
        print(f"--- DEBUG: SUCCESS: Found ffmpeg directory at: {ffmpeg_dir}", flush=True)
        return ffmpeg_dir


    def create_cookie_file(job_id, cookies_string):
        if not cookies_string or not cookies_string.strip():
            return None
        cookie_dir = os.path.join('temp', str(job_id))
        os.makedirs(cookie_dir, exist_ok=True)
        cookie_file_path = os.path.join(cookie_dir, 'cookies.txt')
        header = "# Netscape HTTP Cookie File"
        if not cookies_string.lstrip().startswith(header):
            cookies_string = f"{header}\n{cookies_string}"
        with open(cookie_file_path, 'w', encoding='utf-8') as f:
            f.write(cookies_string)
        return cookie_file_path

    def get_playlist_index(filename):
        try:
            return int(filename.split(' ')[0])
        except (ValueError, IndexError):
            return float('inf')

    # --- Core Download Logic ---

    def download_thread(url, ydl_opts, job_id, download_type, cookies_path):
        temp_dir = os.path.join("temp", str(job_id))
        os.makedirs(temp_dir, exist_ok=True)
        jobs[job_id]['temp_dir'] = temp_dir
        ydl_opts['outtmpl'] = os.path.join(temp_dir, ydl_opts['outtmpl'])
        if cookies_path:
            ydl_opts['cookiefile'] = cookies_path
        try:
            print(f"--- DEBUG: [Job {job_id}] Starting download with yt-dlp options: {ydl_opts}", flush=True)
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info_dict = ydl.extract_info(url, download=False)
                playlist_title = info_dict.get('title', 'playlist')
                jobs[job_id]['playlist_title'] = playlist_title
                ydl.download([url])
            post_download_processing(job_id, temp_dir, download_type, playlist_title)
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            jobs[job_id]['status'] = 'failed'
            jobs[job_id]['error'] = str(e)
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)

    def post_download_processing(job_id, temp_dir, download_type, playlist_title="download"):
        if download_type == "single_mp3":
            files = os.listdir(temp_dir)
            mp3_files = [f for f in files if f.endswith('.mp3')]
            if not mp3_files:
                raise FileNotFoundError("MP3 conversion failed. The MP3 file was not created.")
            file_path = os.path.join(temp_dir, mp3_files[0])
            jobs[job_id].update({'file_path': file_path, 'file_name': os.path.basename(file_path), 'status': 'completed'})
        elif download_type == "playlist_zip":
            zip_filename = f"{playlist_title}.zip"
            zip_path = os.path.join("temp", f"{job_id}.zip")
            mp3_files_found = False
            with zipfile.ZipFile(zip_path, 'w') as zipf:
                for file in os.listdir(temp_dir):
                    if file.endswith('.mp3'):
                        zipf.write(os.path.join(temp_dir, file), arcname=file)
                        mp3_files_found = True
            if not mp3_files_found:
                raise FileNotFoundError("No MP3 files were created for the playlist.")
            jobs[job_id].update({'file_path': zip_path, 'file_name': zip_filename, 'status': 'completed'})
        elif download_type == "combine_playlist_mp3":
            mp3_files = sorted([f for f in os.listdir(temp_dir) if f.endswith('.mp3')], key=get_playlist_index)
            if not mp3_files:
                raise FileNotFoundError("No MP3 files were downloaded to combine.")
            list_file_path = os.path.join(temp_dir, 'filelist.txt')
            with open(list_file_path, 'w', encoding='utf-8') as f:
                for file in mp3_files:
                    safe_path = os.path.abspath(os.path.join(temp_dir, file))
                    safe_path = safe_path.replace("'", "'\\''")
                    f.write(f"file '{safe_path}'\n")
            output_filename = f"{playlist_title} (Combined).mp3"
            output_filepath = os.path.join("temp", output_filename)
            ffmpeg_dir = get_ffmpeg_path()
            if not ffmpeg_dir:
                 raise FileNotFoundError("Could not locate the ffmpeg directory.")
            ffmpeg_exe = "ffmpeg.exe" if platform.system() == "Windows" else "ffmpeg"
            command = [os.path.join(ffmpeg_dir, ffmpeg_exe), '-f', 'concat', '-safe', '0', '-i', list_file_path, '-c', 'copy', '-y', output_filepath]
            subprocess.run(command, check=True, capture_output=True, text=True)
            jobs[job_id].update({'file_path': output_filepath, 'file_name': output_filename, 'status': 'completed'})

    def progress_hook(d):
        job_id = d.get('info_dict', {}).get('job_id')
        if job_id and job_id in jobs:
            if d['status'] == 'downloading':
                jobs[job_id]['status'] = 'downloading'
                jobs[job_id]['progress'] = d.get('_percent_str', '0%').replace('%','').strip()
            elif d['status'] == 'finished':
                jobs[job_id]['status'] = 'processing'

    def create_job(url):
        job_id = str(uuid.uuid4())
        jobs[job_id] = {'status': 'starting', 'url': url, 'progress': '0'}
        return job_id

    # --- API Endpoints ---
    @app.route('/start-job', methods=['POST'])
    def start_job():
        data = request.get_json()
        if not data: return jsonify({'error': 'Invalid JSON request'}), 400
        url = data.get('url')
        job_type = data.get('jobType') 
        cookies = data.get('cookies')
        if not all([url, job_type]): return jsonify({'error': 'Missing url or jobType'}), 400
        job_id = create_job(url)
        cookies_path = create_cookie_file(job_id, cookies)
        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
            'ffmpeg_location': get_ffmpeg_path(),
            'progress_hooks': [lambda d: progress_hook(d)],
            'verbose': True,
            'info_dict': {'job_id': job_id},
            'nocheckcertificate': True
        }
        if job_type in ["playlist_zip", "combine_playlist_mp3"]:
            ydl_opts.update({'outtmpl': '%(playlist_index)s - %(title)s.%(ext)s', 'ignoreerrors': True})
        else:
            ydl_opts.update({'outtmpl': '%(title)s.%(ext)s', 'noplaylist': True})
        thread = threading.Thread(target=download_thread, args=(url, ydl_opts, job_id, job_type, cookies_path))
        thread.daemon = True 
        thread.start()
        return jsonify({'jobId': job_id})

    @app.route('/job-status', methods=['GET'])
    def get_job_status():
        job_id = request.args.get('jobId')
        if not job_id: return jsonify({'status': 'not_found', 'error': 'jobId missing'}), 400
        job = jobs.get(job_id)
        if not job: return jsonify({'status': 'not_found'}), 404
        return jsonify(job)

    @app.route('/download/<job_id>', methods=['GET'])
    def download_file(job_id):
        job = jobs.get(job_id)
        if not job or job['status'] != 'completed': return jsonify({'error': 'File not ready'}), 404
        file_path = job.get('file_path')
        file_name = job.get('file_name')
        temp_dir = job.get('temp_dir') 
        if not file_path or not os.path.exists(file_path): return jsonify({'error': 'File not found'}), 404
        def file_sender():
            try:
                with open(file_path, 'rb') as f:
                    yield from f
            finally:
                if os.path.exists(file_path): os.remove(file_path)
                if temp_dir and os.path.exists(temp_dir): shutil.rmtree(temp_dir, ignore_errors=True)
                jobs.pop(job_id, None)
        return Response(file_sender(), mimetype='application/octet-stream', headers={'Content-Disposition': f'attachment;filename="{file_name}"'})

    # --- Main Execution ---
    if __name__ == '__main__':
        print("--- Starting main execution block (if __name__ == '__main__') ---", flush=True)
        if not os.path.exists('temp'):
            os.makedirs('temp')
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
        # This signal must go to the original stdout so Electron can see it.
        print(f"Flask-Backend-Ready:{port}", file=ORIGINAL_STDOUT, flush=True)
        print(f"--- Starting Flask server on host 127.0.0.1, port {port} ---", flush=True)
        app.run(host='127.0.0.1', port=port, debug=False)

except Exception as e:
    # This is the final safety net. Any crash will be logged.
    print("--- A FATAL UNCAUGHT EXCEPTION OCCURRED ---", file=sys.stderr, flush=True)
    print(f"Log file is at: {LOG_FILE_PATH}", file=sys.stderr, flush=True)
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
