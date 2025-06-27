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

ORIGINAL_STDOUT = sys.stdout
ORIGINAL_STDERR = sys.stderr

try:
    app = Flask(__name__)
    CORS(app)
    jobs = {}

    APP_TEMP_DIR = tempfile.gettempdir()
    print(f"--- Using system temporary directory: {APP_TEMP_DIR} ---", flush=True)

    def get_playlist_index(filename):
        try:
            return int(filename.split(' ')[0])
        except (ValueError, IndexError):
            return float('inf')

    def download_thread(url, ydl_opts, job_id, download_type):
        job_temp_dir = os.path.join(APP_TEMP_DIR, "yt-link", str(job_id))
        os.makedirs(job_temp_dir, exist_ok=True)
        jobs[job_id]['temp_dir'] = job_temp_dir
        
        ydl_opts['outtmpl'] = os.path.join(job_temp_dir, ydl_opts['outtmpl'])
        
        try:
            print(f"--- [Job {job_id}] Starting download...", flush=True)
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info_dict = ydl.extract_info(url, download=False)
                jobs[job_id]['playlist_title'] = info_dict.get('title', 'yt-link-download')
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
        
        print(f"--- [Job {job_id}] Post-processing. Type: {download_type}", flush=True)
        
        if download_type == "singleMp3":
            mp3_file = next((f for f in os.listdir(temp_dir) if f.endswith('.mp3')), None)
            if not mp3_file: raise FileNotFoundError("MP3 conversion failed.")
            job.update({'file_path': os.path.join(temp_dir, mp3_file), 'file_name': mp3_file})

        elif download_type == "playlistZip":
            zip_filename = f"{playlist_title}.zip"
            zip_path = os.path.join(APP_TEMP_DIR, "yt-link", f"{job_id}.zip")
            with zipfile.ZipFile(zip_path, 'w') as zipf:
                for file in os.listdir(temp_dir):
                    if file.endswith('.mp3'):
                        zipf.write(os.path.join(temp_dir, file), arcname=file)
            job.update({'file_path': zip_path, 'file_name': zip_filename})

        elif download_type == "combineMp3":
            mp3_files = sorted([f for f in os.listdir(temp_dir) if f.endswith('.mp3')], key=get_playlist_index)
            if not mp3_files: raise FileNotFoundError("No MP3s found to combine.")
            
            list_file_path = os.path.join(temp_dir, 'filelist.txt')
            with open(list_file_path, 'w', encoding='utf-8') as f:
                for file in mp3_files:
                    f.write(f"file '{os.path.abspath(os.path.join(temp_dir, file))}'\n")
            
            output_filename = f"{playlist_title} (Combined).mp3"
            output_filepath = os.path.join(APP_TEMP_DIR, "yt-link", f"{job_id}_combined.mp3")
            
            ffmpeg_exe = os.path.join(job['ffmpeg_location'], 'ffmpeg.exe' if platform.system() == 'Windows' else 'ffmpeg')
            command = [ffmpeg_exe, '-f', 'concat', '-safe', '0', '-i', list_file_path, '-c', 'copy', '-y', output_filepath]
            
            subprocess.run(command, check=True, capture_output=True)
            job.update({'file_path': output_filepath, 'file_name': output_filename})
        
        job['status'] = 'completed'
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

        # --- BUG FIX: Add logging to verify the received path ---
        ffmpeg_location = data.get('ffmpeg_location')
        print(f"--- [Job Setup] FFMPEG location received: {ffmpeg_location}", flush=True)
        if ffmpeg_location and os.path.isdir(ffmpeg_location):
            print(f"--- [Job Setup] FFMPEG directory exists. Contents: {os.listdir(ffmpeg_location)}", flush=True)
        else:
            print(f"--- [Job Setup] WARNING: FFMPEG directory does not exist or is not a directory.", flush=True, file=sys.stderr)

        if not all(k in data for k in ['url', 'jobType', 'ffmpeg_location']):
            return jsonify({'error': 'Invalid request: Missing required parameters.'}), 400

        job_id = str(uuid.uuid4())
        jobs[job_id] = {'status': 'queued', 'url': data['url'], 'ffmpeg_location': data['ffmpeg_location']}

        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
            'ffmpeg_location': data['ffmpeg_location'],
            'progress_hooks': [progress_hook],
            'nocheckcertificate': True,
            'outtmpl': '%(title)s.%(ext)s',
            'info_dict': {'job_id': job_id},
            'ignoreerrors': data['jobType'] != 'singleMp3',
            'noplaylist': data['jobType'] == 'singleMp3',
        }
        
        if data['jobType'] != 'singleMp3':
            ydl_opts['outtmpl'] = '%(playlist_index)s - %(title)s.%(ext)s'
        
        if data.get('cookies'):
            cookie_file = os.path.join(APP_TEMP_DIR, "yt-link", f"cookies_{job_id}.txt")
            os.makedirs(os.path.dirname(cookie_file), exist_ok=True)
            with open(cookie_file, 'w', encoding='utf-8') as f: f.write(data['cookies'])
            ydl_opts['cookiefile'] = cookie_file

        thread = threading.Thread(target=download_thread, args=(data['url'], ydl_opts, job_id, data['jobType']))
        thread.start()
        
        return jsonify({'jobId': job_id})

    @app.route('/job-status', methods=['GET'])
    def get_job_status():
        job_id = request.args.get('jobId')
        return jsonify(jobs.get(job_id, {'status': 'not_found'}))

    @app.route('/download/<job_id>', methods=['GET'])
    def download_file(job_id):
        job = jobs.get(job_id)
        if not job or job.get('status') != 'completed': return jsonify({'error': 'File not ready'}), 404
        
        def file_generator():
            try:
                with open(job['file_path'], 'rb') as f: yield from f
            finally:
                if os.path.exists(job['file_path']): os.remove(job['file_path'])
                if os.path.exists(job['temp_dir']): shutil.rmtree(job['temp_dir'], ignore_errors=True)
                jobs.pop(job_id, None)
        
        return Response(file_generator(), mimetype='application/octet-stream', headers={'Content-Disposition': f'attachment;filename="{job.get("file_name")}"'})

    if __name__ == '__main__':
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
        print(f"Flask-Backend-Ready:{port}", file=ORIGINAL_STDOUT, flush=True)
        app.run(host='127.0.0.1', port=port, debug=False)

except Exception as e:
    print(f"--- PYTHON BACKEND FATAL CRASH ---\n{traceback.format_exc()}", file=ORIGINAL_STDERR, flush=True)
    sys.exit(1)