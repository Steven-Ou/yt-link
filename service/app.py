import os
import shutil
import sys
import traceback
import threading
import uuid
import zipfile
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import yt_dlp
import platform
import subprocess

# --- Logging Setup ---
# This ensures any error, even at startup, is logged to a file.
LOG_FILE_PATH = os.path.join(os.path.expanduser("~"), "yt_link_backend_debug.log")
ORIGINAL_STDOUT = sys.stdout
ORIGINAL_STDERR = sys.stderr

try:
    log_file = open(LOG_FILE_PATH, 'a', encoding='utf-8', buffering=1) # Use append mode
    # Redirect stdout and stderr to the log file
    sys.stdout = log_file
    sys.stderr = log_file
    print("\n--- Python backend log initialized ---", flush=True)
except Exception as e:
    print(f"CRITICAL: Failed to initialize Python log file. Error: {e}", file=ORIGINAL_STDERR, flush=True)

# --- Main Application Logic ---
try:
    app = Flask(__name__)
    CORS(app)
    jobs = {} # In-memory job store

    def get_playlist_index(filename):
        """Extracts the numeric prefix from a filename for sorting."""
        try:
            return int(filename.split(' ')[0])
        except (ValueError, IndexError):
            return float('inf')

    def download_thread(url, ydl_opts, job_id, download_type):
        """Runs the download in a separate thread."""
        temp_dir = os.path.join("temp", str(job_id))
        os.makedirs(temp_dir, exist_ok=True)
        jobs[job_id]['temp_dir'] = temp_dir
        
        # Set the output template inside the temp directory
        ydl_opts['outtmpl'] = os.path.join(temp_dir, ydl_opts['outtmpl'])
        
        try:
            print(f"--- [Job {job_id}] Starting download with yt-dlp. Options: {ydl_opts}", flush=True)
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info_dict = ydl.extract_info(url, download=False)
                # For playlists, title is at the top level. For single videos, it's also at the top level.
                jobs[job_id]['playlist_title'] = info_dict.get('title', 'yt-link-download')
                
                # Now, perform the actual download
                ydl.download([url])
            
            post_download_processing(job_id, download_type)

        except Exception as e:
            print(f"--- [Job {job_id}] ERROR in download thread: {str(e)}", file=sys.stderr, flush=True)
            traceback.print_exc(file=sys.stderr)
            jobs[job_id]['status'] = 'failed'
            jobs[job_id]['error'] = str(e)

    def post_download_processing(job_id, download_type):
        job = jobs[job_id]
        temp_dir = job['temp_dir']
        playlist_title = job.get('playlist_title', 'download')
        
        print(f"--- [Job {job_id}] Starting post-download processing. Type: {download_type}", flush=True)
        
        if download_type == "singleMp3":
            files = os.listdir(temp_dir)
            mp3_files = [f for f in files if f.endswith('.mp3')]
            if not mp3_files:
                raise FileNotFoundError("MP3 conversion failed. The output file was not created.")
            # Take the first mp3 file found
            original_filename = mp3_files[0]
            final_filepath = os.path.join(temp_dir, original_filename)
            job.update({'file_path': final_filepath, 'file_name': original_filename, 'status': 'completed'})

        elif download_type == "playlistZip":
            zip_filename = f"{playlist_title}.zip"
            zip_path = os.path.join("temp", f"{job_id}.zip")
            with zipfile.ZipFile(zip_path, 'w') as zipf:
                for file in os.listdir(temp_dir):
                    if file.endswith('.mp3'):
                        zipf.write(os.path.join(temp_dir, file), arcname=file)
            job.update({'file_path': zip_path, 'file_name': zip_filename, 'status': 'completed'})

        elif download_type == "combineMp3":
            mp3_files = sorted([f for f in os.listdir(temp_dir) if f.endswith('.mp3')], key=get_playlist_index)
            if not mp3_files:
                raise FileNotFoundError("No MP3 files were downloaded to combine.")
            
            list_file_path = os.path.join(temp_dir, 'filelist.txt')
            with open(list_file_path, 'w', encoding='utf-8') as f:
                for file in mp3_files:
                    safe_path = os.path.abspath(os.path.join(temp_dir, file)).replace("'", "'\\''")
                    f.write(f"file '{safe_path}'\n")
            
            output_filename = f"{playlist_title} (Combined).mp3"
            output_filepath = os.path.join("temp", f"{job_id}_combined.mp3")
            
            ffmpeg_dir = job['ffmpeg_location']
            ffmpeg_exe = "ffmpeg.exe" if platform.system() == "Windows" else "ffmpeg"
            command = [os.path.join(ffmpeg_dir, ffmpeg_exe), '-f', 'concat', '-safe', '0', '-i', list_file_path, '-c', 'copy', '-y', output_filepath]
            
            subprocess.run(command, check=True, capture_output=True, text=True, encoding='utf-8')
            job.update({'file_path': output_filepath, 'file_name': output_filename, 'status': 'completed'})

        print(f"--- [Job {job_id}] Post-processing complete.", flush=True)


    def progress_hook(d):
        job_id = d.get('info_dict', {}).get('job_id')
        if job_id and jobs.get(job_id):
            if d['status'] == 'downloading':
                jobs[job_id]['status'] = 'downloading'
                jobs[job_id]['progress'] = d.get('_percent_str', '0%').replace('%','').strip()
            elif d['status'] == 'finished':
                jobs[job_id]['status'] = 'processing'

    @app.route('/start-job', methods=['POST'])
    def start_job_endpoint():
        data = request.get_json()
        print(f"--- Received /start-job request with payload: {data}", flush=True)

        if not all(k in data for k in ['url', 'jobType', 'ffmpeg_location']):
            return jsonify({'error': 'Invalid request: Missing required parameters.'}), 400

        job_id = str(uuid.uuid4())
        # Store the ffmpeg location with the job data
        jobs[job_id] = {'status': 'queued', 'url': data['url'], 'ffmpeg_location': data['ffmpeg_location']}

        ffmpeg_location = data['ffmpeg_location']

        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
            'ffmpeg_location': ffmpeg_location,
            'progress_hooks': [progress_hook],
            'nocheckcertificate': True,
            'outtmpl': '%(title)s.%(ext)s',
            'info_dict': {'job_id': job_id}
        }
        
        if data.get('cookies'):
             # Create a temporary cookie file for yt-dlp to use
            cookie_dir = os.path.join('temp', str(job_id))
            os.makedirs(cookie_dir, exist_ok=True)
            cookie_file_path = os.path.join(cookie_dir, 'cookies.txt')
            with open(cookie_file_path, 'w', encoding='utf-8') as f:
                f.write(data['cookies'])
            ydl_opts['cookiefile'] = cookie_file_path
        
        if data['jobType'] != 'singleMp3':
            ydl_opts['outtmpl'] = '%(playlist_index)s - %(title)s.%(ext)s'
            ydl_opts['ignoreerrors'] = True
        else:
            ydl_opts['noplaylist'] = True

        thread = threading.Thread(target=download_thread, args=(data['url'], ydl_opts, job_id, data['jobType']))
        thread.start()
        
        return jsonify({'jobId': job_id})

    @app.route('/job-status', methods=['GET'])
    def get_job_status():
        job_id = request.args.get('jobId')
        job = jobs.get(job_id)
        if not job: return jsonify({'status': 'not_found'}), 404
        return jsonify(job)

    @app.route('/download/<job_id>', methods=['GET'])
    def download_file(job_id):
        job = jobs.get(job_id)
        if not job or job.get('status') != 'completed':
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
                # Clean up the specific downloaded file and the job's temp directory
                if os.path.exists(file_path): os.remove(file_path)
                
                temp_dir = job.get('temp_dir')
                if temp_dir and os.path.exists(temp_dir): shutil.rmtree(temp_dir, ignore_errors=True)
                
                jobs.pop(job_id, None)
        
        return Response(file_sender(), mimetype='application/octet-stream', headers={'Content-Disposition': f'attachment;filename="{job.get("file_name")}"'})

    if __name__ == '__main__':
        if not os.path.exists('temp'): os.makedirs('temp')
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
        # This signal MUST go to the original stdout for Electron to detect readiness
        print(f"Flask-Backend-Ready:{port}", file=ORIGINAL_STDOUT, flush=True)
        app.run(host='127.0.0.1', port=port, debug=False)

except Exception as e:
    print("--- A FATAL UNCAUGHT EXCEPTION OCCURRED IN PYTHON BACKEND ---", file=sys.stderr, flush=True)
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
