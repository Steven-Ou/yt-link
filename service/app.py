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

def get_binary_path(binary_name):
    """
    Finds the absolute path to a bundled binary and ensures it is executable.
    This is the most reliable method for packaged apps.
    """
    if not getattr(sys, 'frozen', False):
        # In development, assume the binary is on the system's PATH.
        return binary_name

    try:
        base_path = os.path.dirname(sys.executable)
        
        if platform.system() == "Darwin": # macOS
            # In the .app bundle: .../Contents/Resources/bin/
            bin_dir = os.path.abspath(os.path.join(base_path, '..', 'bin'))
        else: # Windows
            # In the packaged folder: .../bin/
            bin_dir = os.path.join(os.path.dirname(base_path), 'bin')
            binary_name = f"{binary_name}.exe"

        binary_path = os.path.join(bin_dir, binary_name)

        if os.path.exists(binary_path):
            if platform.system() != "Windows":
                try:
                    os.chmod(binary_path, 0o755)
                    print(f"--- PERMISSION CHECK/FIX: Set +x on {binary_name} ---", flush=True)
                except Exception as e:
                    print(f"--- PERMISSION ERROR: Failed to set +x on {binary_path}: {e} ---", file=sys.stderr, flush=True)
            return binary_path
        else:
            print(f"--- BINARY NOT FOUND: Could not find '{binary_path}' ---", file=sys.stderr, flush=True)
            return None
            
    except Exception as e:
        print(f"--- FATAL ERROR in get_binary_path: {e} ---", file=sys.stderr, flush=True)
        return None

# Get the absolute paths to the binaries at startup.
FFMPEG_EXE = get_binary_path('ffmpeg')

try:
    app = Flask(__name__)
    CORS(app)
    jobs = {}
    APP_TEMP_DIR = os.path.join(tempfile.gettempdir(), "yt-link")
    os.makedirs(APP_TEMP_DIR, exist_ok=True)

    def download_thread(url, ydl_opts, job_id, download_type):
        job_temp_dir = os.path.join(APP_TEMP_DIR, str(job_id))
        os.makedirs(job_temp_dir, exist_ok=True)
        jobs[job_id]['temp_dir'] = job_temp_dir
        
        # Set a predictable output filename for manual processing
        ydl_opts['outtmpl'] = os.path.join(job_temp_dir, f"{job_id}.%(ext)s")
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info_dict = ydl.extract_info(url, download=True)
                jobs[job_id]['info'] = info_dict
            
            # Trigger our own post-processing
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
        title = info.get('title', 'yt-link-download').replace('/', '_').replace('\\', '_')
        
        print(f"--- [Job {job_id}] Manual Post-processing. Type: {download_type}", flush=True)

        if not FFMPEG_EXE:
            raise FileNotFoundError("FATAL: FFMPEG executable path was not resolved at startup.")

        downloaded_file = next((os.path.join(temp_dir, f) for f in os.listdir(temp_dir) if f.startswith(job_id)), None)
        
        if not downloaded_file:
            raise FileNotFoundError("Downloaded file could not be found for post-processing.")

        final_filename = f"{title}.mp3"
        output_filepath = os.path.join(temp_dir, final_filename)

        command = [
            FFMPEG_EXE,
            '-i', downloaded_file,
            '-vn', '-ab', '192k', '-ar', '44100',
            '-y', output_filepath
        ]

        print(f"--- [Job {job_id}] Running FFMPEG command: {' '.join(command)} ---", flush=True)
        process = subprocess.run(command, capture_output=True, text=True, encoding='utf-8')

        if process.returncode != 0:
            raise Exception(f"FFMPEG failed with code {process.returncode}: {process.stderr}")

        job.update({'file_path': output_filepath, 'file_name': final_filename, 'status': 'completed', 'message': 'Processing complete!'})
        print(f"--- [Job {job_id}] Post-processing complete.", flush=True)

    def progress_hook(d):
        if d['status'] == 'downloading':
            temp_dir = os.path.dirname(d['filename'])
            job_id = os.path.basename(temp_dir)
            if job_id in jobs:
                percent_str = d.get('_percent_str', '0%').replace('%','').strip()
                jobs[job_id].update({
                    'status': 'downloading',
                    'progress': percent_str,
                    'message': f"Downloading... {percent_str}%"
                })
        elif d['status'] == 'finished':
            temp_dir = os.path.dirname(d['filename'])
            job_id = os.path.basename(temp_dir)
            if job_id in jobs:
                jobs[job_id].update({
                    'status': 'processing',
                    'message': 'Download finished, converting to MP3...'
                })


    @app.route('/start-job', methods=['POST'])
    def start_job_endpoint():
        data = request.get_json()
        job_id = str(uuid.uuid4())
        jobs[job_id] = {'status': 'queued', 'url': data.get('url')}
        
        ydl_opts = {
            'format': 'bestaudio/best',
            # Post-processors removed, we handle it manually
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
        print(f"Flask-Backend-Ready:{port}", flush=True)
        app.run(host='127.0.0.1', port=port, debug=False)

except Exception as e:
    print(f"--- PYTHON BACKEND FATAL CRASH ---\n{traceback.format_exc()}", file=sys.stderr, flush=True)
    sys.exit(1)
