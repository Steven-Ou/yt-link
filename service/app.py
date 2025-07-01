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
        # The base path of the running executable
        base_path = os.path.dirname(sys.executable)
        
        # In a packaged app, binaries are in a 'bin' folder within 'resources'
        # The structure is slightly different on macOS vs. Windows/Linux
        # macOS: <app_name>.app/Contents/Resources/bin/
        # Win/Lin: <app_dir>/resources/bin/
        resources_path = os.path.join(base_path, '..', 'Resources') if platform.system() == "Darwin" else base_path
        bin_dir = os.path.join(resources_path, 'bin')

        # Add .exe for Windows
        if platform.system() == "Windows":
            binary_name = f"{binary_name}.exe"

        binary_path = os.path.join(bin_dir, binary_name)

        if os.path.exists(binary_path):
            if platform.system() != "Windows":
                try:
                    # Set executable permission for non-Windows platforms
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

    def download_thread(url, ydl_opts, job_id, job_type):
        job_temp_dir = os.path.join(APP_TEMP_DIR, str(job_id))
        os.makedirs(job_temp_dir, exist_ok=True)
        jobs[job_id]['temp_dir'] = job_temp_dir
        
        # Use a more descriptive output template to avoid overwrites
        ydl_opts['outtmpl'] = os.path.join(job_temp_dir, '%(playlist_index)s-%(title)s.%(ext)s')
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info_dict = ydl.extract_info(url, download=True)
                jobs[job_id]['info'] = info_dict
            
            # Trigger our own post-processing
            manual_post_processing(job_id, job_type)

        except Exception as e:
            error_message = traceback.format_exc()
            print(f"--- [Job {job_id}] ERROR in download thread: {error_message}", file=sys.stderr, flush=True)
            jobs[job_id]['status'] = 'failed'
            jobs[job_id]['error'] = str(e)

    def manual_post_processing(job_id, job_type):
        job = jobs[job_id]
        temp_dir = job['temp_dir']
        info = job['info']
        playlist_title = info.get('title', 'yt-link-playlist').replace('/', '_').replace('\\', '_')
        
        print(f"--- [Job {job_id}] Manual Post-processing. Type: {job_type}", flush=True)

        if not FFMPEG_EXE:
            raise FileNotFoundError("FATAL: FFMPEG executable path was not resolved at startup.")

        downloaded_files = [os.path.join(temp_dir, f) for f in os.listdir(temp_dir) if not f.endswith('.mp3')]
        if not downloaded_files:
            raise FileNotFoundError("No downloaded files found for post-processing.")

        mp3_files = []
        for i, file_path in enumerate(downloaded_files):
            # Update progress for processing step
            job['message'] = f"Converting file {i+1} of {len(downloaded_files)} to MP3..."
            
            file_name_without_ext = os.path.splitext(os.path.basename(file_path))[0]
            output_filepath = os.path.join(temp_dir, f"{file_name_without_ext}.mp3")
            
            command = [ FFMPEG_EXE, '-i', file_path, '-vn', '-ab', '192k', '-ar', '44100', '-y', output_filepath ]
            
            process = subprocess.run(command, capture_output=True, text=True, encoding='utf-8')
            if process.returncode != 0:
                raise Exception(f"FFMPEG failed for {file_path}: {process.stderr}")
            mp3_files.append(output_filepath)
        
        final_file_path = None
        final_file_name = None

        if job_type == 'singleMp3':
            final_file_path = mp3_files[0]
            final_file_name = os.path.basename(final_file_path)

        elif job_type == 'playlistZip':
            job['message'] = 'Creating ZIP archive...'
            final_file_name = f"{playlist_title}.zip"
            final_file_path = os.path.join(temp_dir, final_file_name)
            with zipfile.ZipFile(final_file_path, 'w') as zipf:
                for mp3_file in mp3_files:
                    zipf.write(mp3_file, os.path.basename(mp3_file))

        elif job_type == 'combineMp3':
            job['message'] = 'Combining all tracks into one MP3...'
            final_file_name = f"{playlist_title} (Combined).mp3"
            final_file_path = os.path.join(temp_dir, final_file_name)
            
            # Create a file list for ffmpeg's concat demuxer
            concat_list_path = os.path.join(temp_dir, 'concat_list.txt')
            with open(concat_list_path, 'w', encoding='utf-8') as f:
                for mp3_file in sorted(mp3_files):
                    # FFMPEG requires special characters to be escaped
                    safe_path = mp3_file.replace("'", "'\\''")
                    f.write(f"file '{safe_path}'\n")
            
            combine_command = [FFMPEG_EXE, '-f', 'concat', '-safe', '0', '-i', concat_list_path, '-c', 'copy', '-y', final_file_path]
            combine_process = subprocess.run(combine_command, capture_output=True, text=True, encoding='utf-8')
            if combine_process.returncode != 0:
                raise Exception(f"FFMPEG combine failed: {combine_process.stderr}")

        job.update({'file_path': final_file_path, 'file_name': final_file_name, 'status': 'completed', 'message': 'Processing complete!'})
        print(f"--- [Job {job_id}] Post-processing complete. Output: {final_file_name}", flush=True)

    # The rest of the file (progress_hook, Flask routes) remains the same.
    def progress_hook(d):
        if d['status'] == 'downloading':
            job_id = d.get('info_dict', {}).get('job_id')
            if job_id in jobs:
                percent_str = d.get('_percent_str', '0%').replace('%','').strip()
                total_bytes = d.get('total_bytes') or d.get('total_bytes_estimate')
                if total_bytes:
                     # Calculate overall progress for playlists
                    playlist_index = d.get('playlist_index', 1)
                    playlist_count = jobs[job_id]['info'].get('playlist_count', 1)
                    progress = ((playlist_index - 1) / playlist_count) * 100 + float(percent_str) / playlist_count
                else:
                    progress = float(percent_str)
                
                jobs[job_id].update({
                    'status': 'downloading',
                    'progress': f"{progress:.2f}",
                    'message': f"Downloading video {d.get('playlist_index', 1)} of {jobs[job_id]['info'].get('playlist_count', 1)}... {percent_str}%"
                })

        elif d['status'] == 'finished':
            job_id = d.get('info_dict', {}).get('job_id')
            if job_id in jobs:
                 jobs[job_id].update({
                    'status': 'processing',
                    'message': 'Download finished, preparing for conversion...'
                })


    @app.route('/start-job', methods=['POST'])
    def start_job_endpoint():
        data = request.get_json()
        job_id = str(uuid.uuid4())
        job_type = data.get('jobType')
        jobs[job_id] = {'status': 'queued', 'url': data.get('url'), 'job_type': job_type}
        
        ydl_opts = {
            'format': 'bestaudio/best',
            'progress_hooks': [progress_hook],
            'nocheckcertificate': True,
            'ignoreerrors': job_type != 'singleMp3',
            'noplaylist': job_type == 'singleMp3',
            # Pass job_id to the hook info_dict
            'outtmpl': {'default': os.path.join(APP_TEMP_DIR, str(job_id), '%(playlist_index)s-%(title)s.%(ext)s')},
            'download_archive': False
        }
        # Add job_id to info_dict for progress hook
        def add_job_id(info_dict):
            info_dict['job_id'] = job_id
        ydl_opts['postprocessor_hooks'] = [add_job_id]


        if data.get('cookies'):
            cookie_file = os.path.join(APP_TEMP_DIR, f"cookies_{job_id}.txt")
            os.makedirs(os.path.dirname(cookie_file), exist_ok=True)
            with open(cookie_file, 'w', encoding='utf-8') as f: f.write(data['cookies'])
            ydl_opts['cookiefile'] = cookie_file

        thread = threading.Thread(target=download_thread, args=(data['url'], ydl_opts, job_id, job_type))
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
                # Clean up the entire job directory
                temp_dir = job.get('temp_dir')
                if temp_dir and os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir, ignore_errors=True)
                jobs.pop(job_id, None)
        
        file_name = job.get("file_name")
        
        encoded_file_name = quote(file_name)
        fallback_file_name = file_name.encode('ascii', 'ignore').decode('ascii')
        if not fallback_file_name:
            fallback_file_name = "download.dat"

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
