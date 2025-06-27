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
    # Use a subdirectory within the system's temp folder for better organization
    APP_TEMP_DIR = os.path.join(tempfile.gettempdir(), "yt-link")
    os.makedirs(APP_TEMP_DIR, exist_ok=True)
    print(f"--- Using application temporary directory: {APP_TEMP_DIR} ---", flush=True)

    def get_playlist_index(filename):
        try:
            # Handle filenames that might not have a space, like '1-title.mp3' or '1.title.mp3'
            return int(filename.split('-')[0].split('.')[0].strip())
        except (ValueError, IndexError):
            return float('inf')

    def download_thread(url, ydl_opts, job_id, download_type):
        # Each job gets its own subdirectory inside the app's temp folder
        job_temp_dir = os.path.join(APP_TEMP_DIR, str(job_id))
        os.makedirs(job_temp_dir, exist_ok=True)
        jobs[job_id]['temp_dir'] = job_temp_dir
        ydl_opts['outtmpl'] = os.path.join(job_temp_dir, ydl_opts['outtmpl'])
        
        try:
            print(f"--- [Job {job_id}] Starting download...", flush=True)
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info_dict = ydl.extract_info(url, download=False)
                # Store playlist title safely
                playlist_title = info_dict.get('title', 'yt-link-download')
                safe_playlist_title = "".join(c for c in playlist_title if c.isalnum() or c in (' ', '-', '_')).rstrip()
                jobs[job_id]['playlist_title'] = safe_playlist_title
                
                ydl.download([url])
            post_download_processing(job_id, download_type)
        except Exception as e:
            error_message = traceback.format_exc()
            print(f"--- [Job {job_id}] ERROR in download thread: {error_message}", file=sys.stderr, flush=True)
            jobs[job_id]['status'] = 'failed'
            # Provide a more specific error if it's a known yt-dlp issue
            if isinstance(e, yt_dlp.utils.DownloadError):
                jobs[job_id]['error'] = f"Download failed: {e.args[0]}"
            else:
                jobs[job_id]['error'] = str(e)


    def post_download_processing(job_id, download_type):
        job = jobs[job_id]
        temp_dir = job['temp_dir']
        playlist_title = job.get('playlist_title', 'download')
        
        print(f"--- [Job {job_id}] Post-processing. Type: {download_type}", flush=True)
        
        if download_type == "singleMp3":
            mp3_file = next((f for f in os.listdir(temp_dir) if f.endswith('.mp3')), None)
            if not mp3_file: raise FileNotFoundError("MP3 conversion failed, file not found.")
            job.update({'file_path': os.path.join(temp_dir, mp3_file), 'file_name': mp3_file})

        elif download_type == "playlistZip":
            zip_filename = f"{playlist_title}.zip"
            zip_path = os.path.join(APP_TEMP_DIR, f"{job_id}.zip")
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for file in sorted(os.listdir(temp_dir), key=get_playlist_index):
                    if file.endswith('.mp3'):
                        zipf.write(os.path.join(temp_dir, file), arcname=file)
            job.update({'file_path': zip_path, 'file_name': zip_filename})

        elif download_type == "combineMp3":
            mp3_files = sorted([f for f in os.listdir(temp_dir) if f.endswith('.mp3')], key=get_playlist_index)
            if not mp3_files: raise FileNotFoundError("No MP3s found to combine.")
            
            list_file_path = os.path.join(temp_dir, 'filelist.txt')
            with open(list_file_path, 'w', encoding='utf-8') as f:
                for file in mp3_files:
                    # Use relative paths inside the text file for safety
                    f.write(f"file '{file}'\n")
            
            output_filename = f"{playlist_title} (Combined).mp3"
            output_filepath = os.path.join(APP_TEMP_DIR, f"{job_id}_combined.mp3")
            
            # **FIX**: Construct the full, absolute path to the ffmpeg executable
            ffmpeg_dir = job.get('ffmpeg_location')
            if not ffmpeg_dir:
                 raise EnvironmentError("ffmpeg_location path was not provided to the job.")
            ffmpeg_exe = os.path.join(ffmpeg_dir, 'ffmpeg.exe' if platform.system() == 'Windows' else 'ffmpeg')

            command = [ffmpeg_exe, '-f', 'concat', '-safe', '0', '-i', list_file_path, '-c', 'copy', '-y', output_filepath]
            
            print(f"--- [Job {job_id}] Running FFmpeg command: {' '.join(command)}", flush=True)
            # Run the command from the directory containing the files
            subprocess.run(command, check=True, capture_output=True, text=True, cwd=temp_dir)
            job.update({'file_path': output_filepath, 'file_name': output_filename})
        
        job['status'] = 'completed'
        job['message'] = 'Processing complete!'
        print(f"--- [Job {job_id}] Post-processing complete.", flush=True)

    def progress_hook(d):
        # Attach job_id to the info_dict if it's not already there
        job_id = d.get('info_dict', {}).get('job_id')
        if not job_id:
            return # Cannot update status without a job_id
            
        if d['status'] == 'downloading':
            jobs[job_id]['status'] = 'downloading'
            # Sanitize percent string before converting
            percent_str = d.get('_percent_str', '0%').replace('%','').strip()
            try:
                jobs[job_id]['progress'] = float(percent_str)
            except (ValueError, TypeError):
                jobs[job_id]['progress'] = 0
            jobs[job_id]['message'] = f"Downloading... {percent_str}% of {d.get('_total_bytes_str', 'N/A')}"
        elif d['status'] == 'finished':
            jobs[job_id]['status'] = 'processing'
            jobs[job_id]['message'] = 'Download finished, now converting...'


    @app.route('/start-job', methods=['POST'])
    def start_job_endpoint():
        data = request.get_json()
        job_id = str(uuid.uuid4())
        jobs[job_id] = {
            'status': 'queued',
            'url': data.get('url'),
            # **FIX**: Store the ffmpeg location for this specific job
            'ffmpeg_location': data.get('ffmpeg_location')
        }

        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
            'progress_hooks': [progress_hook],
            'nocheckcertificate': True,
            'outtmpl': '%(title)s.%(ext)s',
            'ignoreerrors': data.get('jobType') != 'singleMp3',
            'noplaylist': data.get('jobType') == 'singleMp3',
            # Pass job_id into yt-dlp so the progress hook can access it
            '__youtubedl_info_dict': {'job_id': job_id}
        }
        
        # **FIX**: Explicitly tell yt-dlp where to find ffmpeg
        if data.get('ffmpeg_location'):
            ydl_opts['ffmpeg_location'] = data.get('ffmpeg_location')
        
        if data.get('jobType') != 'singleMp3':
            ydl_opts['outtmpl'] = '%(playlist_index)s - %(title)s.%(ext)s'
        
        if data.get('cookies'):
            cookie_file = os.path.join(APP_TEMP_DIR, f"cookies_{job_id}.txt")
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
    def download_file_endpoint(job_id):
        job = jobs.get(job_id)
        if not job or job.get('status') != 'completed': 
            return jsonify({'error': 'File not ready or job not found'}), 404
        
        file_path = job.get('file_path')
        if not file_path or not os.path.exists(file_path):
            return jsonify({'error': 'File not found on server.'}), 404

        def file_generator():
            try:
                with open(file_path, 'rb') as f:
                    yield from f
            finally:
                # Cleanup: Remove the final file and the temporary job directory
                if os.path.exists(file_path):
                    os.remove(file_path)
                if 'temp_dir' in job and os.path.exists(job['temp_dir']):
                    shutil.rmtree(job['temp_dir'], ignore_errors=True)
                # Remove job from memory
                jobs.pop(job_id, None)
        
        return Response(file_generator(), mimetype='application/octet-stream', headers={'Content-Disposition': f'attachment;filename="{job.get("file_name")}"'})

    if __name__ == '__main__':
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
        print(f"Flask-Backend-Ready:{port}", file=ORIGINAL_STDOUT, flush=True)
        app.run(host='127.0.0.1', port=port, debug=False)

except Exception as e:
    # Ensure any catastrophic startup failure is logged
    print(f"--- PYTHON BACKEND FATAL CRASH ---\n{traceback.format_exc()}", file=ORIGINAL_STDERR, flush=True)
    sys.exit(1)
