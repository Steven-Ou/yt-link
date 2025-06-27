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

# --- Setup Logging ---
# This ensures any error, even at startup, is logged.
LOG_FILE_PATH = os.path.join(os.path.expanduser("~"), "yt_link_backend_debug.log")
ORIGINAL_STDOUT = sys.stdout
ORIGINAL_STDERR = sys.stderr

try:
    log_file = open(LOG_FILE_PATH, 'w', encoding='utf-8', buffering=1)
    sys.stdout = log_file
    sys.stderr = log_file
    print("--- Python backend log initialized ---", flush=True)
except Exception as e:
    # If logging fails, print to the original stderr so it appears in the Electron console
    print(f"CRITICAL: Failed to initialize Python log file. Error: {e}", file=ORIGINAL_STDERR, flush=True)

# --- Main Application ---
try:
    print("--- Initializing Flask App ---", flush=True)
    app = Flask(__name__)
    CORS(app)
    jobs = {} # In-memory job store

    # --- Helper Functions ---

    def get_playlist_index(filename):
        """Extracts the numeric prefix from a filename for sorting."""
        try:
            return int(filename.split(' ')[0])
        except (ValueError, IndexError):
            return float('inf') # Put files without a number at the end

    # --- Core Download Logic ---

    def download_thread(url, ydl_opts, job_id, download_type):
        """Runs the download in a separate thread to avoid blocking the server."""
        temp_dir = os.path.join("temp", str(job_id))
        os.makedirs(temp_dir, exist_ok=True)
        jobs[job_id]['temp_dir'] = temp_dir
        
        # Set the output template inside the temp directory
        ydl_opts['outtmpl'] = os.path.join(temp_dir, ydl_opts['outtmpl'])
        
        try:
            print(f"--- [Job {job_id}] Starting download with yt-dlp. Options: {ydl_opts}", flush=True)
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                # First, extract info without downloading to get the title
                info_dict = ydl.extract_info(url, download=False)
                playlist_title = info_dict.get('title', 'playlist')
                jobs[job_id]['playlist_title'] = playlist_title
                
                print(f"--- [Job {job_id}] Playlist/Video Title: {playlist_title}", flush=True)
                
                # Now, perform the actual download
                ydl.download([url])
            
            # Once download is complete, process the files
            post_download_processing(job_id, temp_dir, download_type, playlist_title)

        except Exception as e:
            # Log any exception that occurs during the download
            print(f"--- [Job {job_id}] Download thread failed! ---", file=sys.stderr, flush=True)
            traceback.print_exc(file=sys.stderr)
            jobs[job_id]['status'] = 'failed'
            # Provide a user-friendly error message
            error_message = str(e)
            if 'ffmpeg' in error_message.lower():
                jobs[job_id]['error'] = "Postprocessing Error: ffmpeg was not found. Please ensure it's correctly placed in the 'bin' folder."
            else:
                jobs[job_id]['error'] = error_message

    def post_download_processing(job_id, temp_dir, download_type, playlist_title="download"):
        """Handles file operations after download (zipping, combining, etc.)."""
        print(f"--- [Job {job_id}] Starting post-download processing. Type: {download_type}", flush=True)
        if download_type == "singleMp3":
            files = os.listdir(temp_dir)
            mp3_files = [f for f in files if f.endswith('.mp3')]
            if not mp3_files:
                raise FileNotFoundError("MP3 conversion failed. The output file was not created.")
            file_path = os.path.join(temp_dir, mp3_files[0])
            jobs[job_id].update({'file_path': file_path, 'file_name': os.path.basename(file_path), 'status': 'completed'})
        
        elif download_type == "playlistZip":
            zip_filename = f"{playlist_title}.zip"
            zip_path = os.path.join("temp", f"{job_id}.zip") # Store zip outside the temp_dir to be cleaned up
            with zipfile.ZipFile(zip_path, 'w') as zipf:
                for file in os.listdir(temp_dir):
                    if file.endswith('.mp3'):
                        zipf.write(os.path.join(temp_dir, file), arcname=file)
            jobs[job_id].update({'file_path': zip_path, 'file_name': zip_filename, 'status': 'completed'})

        elif download_type == "combineMp3":
            mp3_files = sorted([f for f in os.listdir(temp_dir) if f.endswith('.mp3')], key=get_playlist_index)
            if not mp3_files:
                raise FileNotFoundError("No MP3 files were downloaded to combine.")
            
            list_file_path = os.path.join(temp_dir, 'filelist.txt')
            with open(list_file_path, 'w', encoding='utf-8') as f:
                for file in mp3_files:
                    # Create safe paths for ffmpeg's concat demuxer
                    safe_path = os.path.abspath(os.path.join(temp_dir, file)).replace("'", "'\\''")
                    f.write(f"file '{safe_path}'\n")
            
            output_filename = f"{playlist_title} (Combined).mp3"
            output_filepath = os.path.join("temp", f"{job_id}_combined.mp3")
            
            # Get ffmpeg path from the job data, which came from Electron
            ffmpeg_dir = jobs[job_id]['ffmpeg_location']
            ffmpeg_exe = "ffmpeg.exe" if platform.system() == "Windows" else "ffmpeg"
            command = [os.path.join(ffmpeg_dir, ffmpeg_exe), '-f', 'concat', '-safe', '0', '-i', list_file_path, '-c', 'copy', '-y', output_filepath]
            
            print(f"--- [Job {job_id}] Running ffmpeg combine command: {' '.join(command)}", flush=True)
            subprocess.run(command, check=True, capture_output=True, text=True, encoding='utf-8')
            
            jobs[job_id].update({'file_path': output_filepath, 'file_name': output_filename, 'status': 'completed'})
        
        print(f"--- [Job {job_id}] Post-processing completed successfully.", flush=True)

    def progress_hook(d):
        """Hook for yt-dlp to report progress."""
        job_id = d.get('info_dict', {}).get('job_id')
        if job_id and job_id in jobs:
            if d['status'] == 'downloading':
                jobs[job_id]['status'] = 'downloading'
                # Extract percentage and title for richer progress updates
                percent_str = d.get('_percent_str', '0%').replace('%', '').strip()
                jobs[job_id]['progress'] = f"{percent_str}%"
                if 'info_dict' in d and 'title' in d['info_dict']:
                    jobs[job_id]['current_file'] = d['info_dict']['title']
            elif d['status'] == 'finished':
                jobs[job_id]['status'] = 'processing'
                jobs[job_id]['progress'] = "100%"
    
    # --- API Endpoints ---

    @app.route('/start-job', methods=['POST'])
    def start_job_endpoint():
        """Endpoint to create and start a new download job."""
        data = request.get_json()
        print(f"--- Received /start-job request with data: {data}", flush=True)

        if not data or not data.get('url') or not data.get('jobType') or not data.get('ffmpeg_location'):
            return jsonify({'error': 'Invalid request: Missing url, jobType, or ffmpeg_location'}), 400

        job_id = str(uuid.uuid4())
        jobs[job_id] = {
            'status': 'starting',
            'url': data['url'],
            'progress': '0%',
            'ffmpeg_location': data['ffmpeg_location'] # Store ffmpeg path
        }
        
        # **DEFINITIVE FIX**: Get ffmpeg path from the payload for every job
        ffmpeg_location = data['ffmpeg_location']
        if not os.path.isdir(ffmpeg_location):
            error_msg = f"ffmpeg_location provided is not a valid directory: {ffmpeg_location}"
            print(f"--- [Job {job_id}] {error_msg}", file=sys.stderr, flush=True)
            return jsonify({'error': error_msg}), 400

        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
            'ffmpeg_location': ffmpeg_location,
            'progress_hooks': [progress_hook],
            'verbose': True, # Enable verbose logging from yt-dlp
            'nocheckcertificate': True,
            # Pass job_id to the progress hook
            'outtmpl': {'default': '%(title)s.%(ext)s'},
            'download_archive': False # Ensure every item is downloaded
        }
        # Add the job_id to the info_dict so the progress hook can access it.
        ydl_opts['outtmpl']['default'] = f"%(playlist_index)s - {ydl_opts['outtmpl']['default']}" if data['jobType'] != "singleMp3" else ydl_opts['outtmpl']['default']
        ydl_opts['info_dict'] = {'job_id': job_id}


        if data.get('cookies_path'):
            ydl_opts['cookiefile'] = data['cookies_path']
        
        # Start the download in a new thread
        thread = threading.Thread(target=download_thread, args=(data['url'], ydl_opts, job_id, data['jobType']))
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
        if not job or job['status'] != 'completed':
            return jsonify({'error': 'File not ready or job not found'}), 404
        
        file_path = job.get('file_path')
        if not file_path or not os.path.exists(file_path):
            return jsonify({'error': 'File not found on server'}), 404
        
        def file_sender():
            """Generator to send the file and then clean up."""
            try:
                with open(file_path, 'rb') as f:
                    yield from f
            finally:
                # Clean up the downloaded file and temp directory
                if os.path.exists(file_path): os.remove(file_path)
                
                temp_dir = job.get('temp_dir')
                if temp_dir and os.path.exists(temp_dir): shutil.rmtree(temp_dir, ignore_errors=True)
                
                cookie_path = job.get('cookies_path')
                if cookie_path and os.path.exists(cookie_path): os.remove(cookie_path)
                
                jobs.pop(job_id, None) # Remove job from memory
        
        return Response(file_sender(), mimetype='application/octet-stream', headers={'Content-Disposition': f'attachment;filename="{job.get("file_name")}"'})

    # --- Main Execution ---
    if __name__ == '__main__':
        if not os.path.exists('temp'):
            os.makedirs('temp')
        
        # Port is the first command-line argument
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
        
        # This signal MUST go to the original stdout for Electron to detect readiness
        print(f"Flask-Backend-Ready:{port}", file=ORIGINAL_STDOUT, flush=True)
        
        print(f"--- Flask server starting on http://127.0.0.1:{port} ---", flush=True)
        app.run(host='127.0.0.1', port=port, debug=False)

except Exception as e:
    # This is the final safety net. Any uncaught exception during setup will be logged.
    print("--- A FATAL UNCAUGHT EXCEPTION OCCURRED IN PYTHON BACKEND ---", file=sys.stderr, flush=True)
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
