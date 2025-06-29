import os
import shutil
import sys
import traceback
import threading
import uuid
import zipfile
import tempfile
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import yt_dlp
import platform
import subprocess
from urllib.parse import quote

ORIGINAL_STDOUT = sys.stdout
ORIGINAL_STDERR = sys.stderr

def get_ffmpeg_path(binary_name):
    """
    Finds the absolute path to a bundled binary (ffmpeg or ffprobe).
    """
    if not getattr(sys, 'frozen', False):
        # In dev, assume it's on the system PATH
        return binary_name

    try:
        base_path = os.path.dirname(sys.executable)
        
        if platform.system() == "Darwin": # macOS
            bin_dir = os.path.abspath(os.path.join(base_path, '..', 'bin'))
        else: # Windows
            bin_dir = os.path.join(base_path, 'bin')
            binary_name = f"{binary_name}.exe"

        binary_path = os.path.join(bin_dir, binary_name)

        if os.path.exists(binary_path):
            if platform.system() != "Windows":
                try:
                    os.chmod(binary_path, 0o755)
                    print(f"--- PERMISSION FIX: Set +x on {binary_name} ---", flush=True)
                except Exception as e:
                    print(f"--- PERMISSION FIX: FAILED to set +x on {binary_name}: {e} ---", file=sys.stderr, flush=True)
            return binary_path
        else:
            print(f"--- FFMPEG_PATH: CRITICAL! Binary not found at '{binary_path}' ---", file=sys.stderr, flush=True)
            return None
            
    except Exception as e:
        print(f"--- FFMPEG_PATH: CRITICAL ERROR while determining path: {e}", file=sys.stderr, flush=True)
        return None

FFMPEG_EXE = get_ffmpeg_path('ffmpeg')

try:
    app = Flask(__name__)
    CORS(app)
    jobs = {}
    APP_TEMP_DIR = os.path.join(tempfile.gettempdir(), "yt-link")
    os.makedirs(APP_TEMP_DIR, exist_ok=True)
    print(f"--- Using application temporary directory: {APP_TEMP_DIR} ---", flush=True)

    def download_thread(url, ydl_opts, job_id, download_type):
        job_temp_dir = os.path.join(APP_TEMP_DIR, str(job_id))
        os.makedirs(job_temp_dir, exist_ok=True)
        jobs[job_id]['temp_dir'] = job_temp_dir
        
        # We will manually handle file extensions
        ydl_opts['outtmpl'] = os.path.join(job_temp_dir, f"{job_id}.%(ext)s")
        
        try:
            print(f"--- [Job {job_id}] Starting download...", flush=True)
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info_dict = ydl.extract_info(url, download=True)
                jobs[job_id]['info'] = info_dict
            
            # Now, trigger our own post-processing
            manual_post_processing(job_id, download_type)

        except Exception as e:
            error_message = traceback.format_exc()
            print(f"--- [Job {job_id}] ERROR in download thread: {error_message}", file=sys.stderr, flush=True)
            jobs[job_id]['status'] = 'failed'
            jobs[job_id]['error'] = str(e)

    def manual_post_processing(job_id, download_type):
        job = jobs[job_id]
        temp_dir = job['temp_dir']
        info = job['info']
        
        # Sanitize title for the final filename
        title = info.get('title', 'yt-link-download').replace('/', '_').replace('\\', '_')
        
        print(f"--- [Job {job_id}] Manual Post-processing. Type: {download_type}", flush=True)

        if not FFMPEG_EXE:
            raise FileNotFoundError("FATAL: FFMPEG executable not found in packaged app.")

        # Find the downloaded file (it will have our job_id as the name)
        downloaded_file = None
        for f in os.listdir(temp_dir):
            if f.startswith(job_id):
                downloaded_file = os.path.join(temp_dir, f)
                break
        
        if not downloaded_file:
            raise FileNotFoundError("Download file could not be found for post-processing.")

        final_filename = f"{title}.mp3"
        output_filepath = os.path.join(temp_dir, final_filename)

        # Build the ffmpeg command
        # -i: input file
        # -vn: no video
        # -ab: audio bitrate
        # -ar: audio rate
        # -y: overwrite output file
        command = [
            FFMPEG_EXE,
            '-i', downloaded_file,
            '-vn',
            '-ab', '192k',
            '-ar', '44100',
            '-y',
            output_filepath
        ]

        print(f"--- [Job {job_id}] Running FFMPEG command: {' '.join(command)} ---", flush=True)
        # We don't use cwd here because FFMPEG_EXE is an absolute path
        process = subprocess.run(command, capture_output=True, text=True)

        if process.returncode != 0:
            print(f"--- FFMPEG ERROR STDOUT ---\n{process.stdout}", file=sys.stderr, flush=True)
            print(f"--- FFMPEG ERROR STDERR ---\n{process.stderr}", file=sys.stderr, flush=True)
            raise Exception(f"FFMPEG failed with code {process.returncode}: {process.stderr}")

        job.update({'file_path': output_filepath, 'file_name': final_filename})
        job['status'] = 'completed'
        job['message'] = 'Processing complete!'
        print(f"--- [Job {job_id}] Post-processing complete.", flush=True)


    @app.route('/start-job', methods=['POST'])
    def start_job_endpoint():
        data = request.get_json()
        job_id = str(uuid.uuid4())
        jobs[job_id] = {'status': 'queued', 'url': data.get('url')}
        
        ydl_opts = {
            # Download best audio format available
            'format': 'bestaudio/best',
            # We are no longer using yt-dlp's post-processor
            # 'postprocessors': [...],
            'progress_hooks': [progress_hook],
            'nocheckcertificate': True,
            'ignoreerrors': data.get('jobType') != 'singleMp3',
            'noplaylist': data.get('jobType') == 'singleMp3',
        }
        
        if data.get('cookies'):
            cookie_file = os.path.join(APP_TEMP_DIR, f"cookies_{job_id}.txt")
            os.makedirs(os.path.dirname(cookie_file), exist_ok=True)
            with open(cookie_file, 'w', encoding='utf-8') as f: f.write(data['cookies'])
            ydl_opts['cookiefile'] = cookie_file

        thread = threading.Thread(target=download_thread, args=(data['url'], ydl_opts, job_id, data.get('jobType')))
        thread.start()
        
        return jsonify({'jobId': job_id})

    # The rest of your Flask routes (job-status, download) remain the same
    # as they operate on the job dictionary which we are still updating correctly.
    # ... (progress_hook, get_job_status, download_file, and main block are omitted for brevity, they don't need changes) ...
    def progress_hook(d):
        job_id_from_info = d.get('info_dict', {}).get('__finaldir')
        if not job_id_from_info: return

        job_id = os.path.basename(job_id_from_info)

        if job_id in jobs:
            if d['status'] == 'downloading':
                jobs[job_id]['status'] = 'downloading'
                percent_str = d.get('_percent_str', '0%').replace('%','').strip()
                jobs[job_id]['progress'] = percent_str
                jobs[job_id]['message'] = f"Downloading... {percent_str}%"
            elif d['status'] == 'finished':
                jobs[job_id]['status'] = 'processing'
                jobs[job_id]['message'] = 'Download finished, converting to MP3...'

    @app.route('/job-status', methods=['GET'])
    def get_job_status():
        job_id = request.args.get('jobId')
        return jsonify(jobs.get(job_id, {'status': 'not_found'}))

    @app.route('/download/<job_id>', methods=['GET'])
    def download_file(job_id):
        job = jobs.get(job_id)
        if not job or job.get('status') != 'completed': 
            return jsonify({'error': 'File not ready or job not found'}), 404
        
        file_path = job.get('file_path')
        if not file_path or not os.path.exists(file_path):
            return jsonify({'error': 'File not found on server.'}), 404

        def file_generator():
            try:
                with open(file_path, 'rb') as f: yield from f
            finally:
                if os.path.exists(file_path): os.remove(file_path)
                if 'temp_dir' in job and os.path.exists(job['temp_dir']): shutil.rmtree(job['temp_dir'], ignore_errors=True)
                jobs.pop(job_id, None)
        
        file_name = job.get("file_name")
        
        encoded_file_name = quote(file_name)
        fallback_file_name = file_name.encode('ascii', 'ignore').decode('ascii') or "download.mp3"

        headers = {
            'Content-Disposition': f'attachment; filename="{fallback_file_name}"; filename*="UTF-8\'\'{encoded_file_name}"'
        }
        
        return Response(file_generator(), mimetype='application/octet-stream', headers=headers)

    if __name__ == '__main__':
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
        print(f"Flask-Backend-Ready:{port}", file=ORIGINAL_STDOUT, flush=True)
        app.run(host='127.0.0.1', port=port, debug=False)

except Exception as e:
    print(f"--- PYTHON BACKEND FATAL CRASH ---\n{traceback.format_exc()}", file=ORIGINAL_STDERR, flush=True)
    sys.exit(1)
