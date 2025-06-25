import os
import shutil
import sys
import threading
import time
import uuid
import zipfile
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import yt_dlp
import platform
import subprocess

# --- Flask App Initialization ---
app = Flask(__name__)
CORS(app)

# In-memory dictionary to store job status and results
jobs = {}

# --- Helper Functions ---

def get_ffmpeg_path():
    """
    Determines the correct, robust path for the FFMPEG directory,
    handling both development and packaged (production) environments.
    This is the definitive, corrected function.
    """
    # --- Packaged App (Production) ---
    # getattr(sys, 'frozen', False) is the standard way to check if running in a PyInstaller bundle.
    if getattr(sys, 'frozen', False):
        # When packaged, sys._MEIPASS is the path to the temporary folder where PyInstaller unpacks data.
        # However, for finding resources packaged by Electron-Builder, we must start from sys.executable.
        # sys.executable is the path to your `yt-link-backend` executable.
        # e.g., /Applications/YT Link.app/Contents/Resources/backend/yt-link-backend
        backend_dir = os.path.dirname(sys.executable)
        
        # Based on your package.json `extraResources`, the 'bin' folder is a sibling to the 'backend' folder.
        # We navigate up one level from `backend_dir` to the main `Resources` folder, then into `bin`.
        ffmpeg_dir = os.path.join(backend_dir, '..', 'bin')
        
        # Absolute path normalization for safety and logging.
        ffmpeg_dir = os.path.abspath(ffmpeg_dir)

        # Critical check: if the directory isn't where we expect it, the app cannot function.
        if not os.path.isdir(ffmpeg_dir):
            error_message = f"FATAL: Packaged ffmpeg directory not found at expected path: {ffmpeg_dir}"
            print(error_message, file=sys.stderr)
            raise FileNotFoundError(error_message)
            
        print(f"INFO: [Packaged Mode] Using ffmpeg directory: {ffmpeg_dir}")
        return ffmpeg_dir

    # --- Development Environment ---
    else:
        # In dev, this script is in the 'service' folder. We find ffmpeg relative to the project root.
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        ffmpeg_dir = os.path.join(project_root, 'bin')

        if os.path.isdir(ffmpeg_dir):
            print(f"INFO: [Dev Mode] Using ffmpeg directory: {ffmpeg_dir}")
            return ffmpeg_dir
        else:
            # Fallback to system PATH only if not found in the project structure for local dev convenience.
            print("WARNING: ffmpeg not found in project 'bin' folder, falling back to system PATH.", file=sys.stderr)
            return None # Let yt-dlp search the PATH by default


def create_cookie_file(job_id, cookies_string):
    """Creates a temporary cookie file from a string to pass to yt-dlp."""
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
    """Robustly extracts a numerical prefix from a filename for sorting."""
    try:
        return int(filename.split(' ')[0])
    except (ValueError, IndexError):
        return float('inf')

# --- Core Download Logic ---

def download_thread(url, ydl_opts, job_id, download_type, cookies_path):
    """Runs the download process in a separate thread."""
    temp_dir = os.path.join("temp", str(job_id))
    os.makedirs(temp_dir, exist_ok=True)
    
    jobs[job_id]['temp_dir'] = temp_dir
    ydl_opts['outtmpl'] = os.path.join(temp_dir, ydl_opts['outtmpl'])

    if cookies_path:
        ydl_opts['cookiefile'] = cookies_path

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=False)
            playlist_title = info_dict.get('title', 'playlist')
            jobs[job_id]['playlist_title'] = playlist_title
            
            ydl.download([url])

        post_download_processing(job_id, temp_dir, download_type, playlist_title)

    except Exception as e:
        print(f"ERROR in download_thread for job {job_id}: {e}", file=sys.stderr)
        # Provide the actual error message to the frontend for better debugging.
        jobs[job_id]['status'] = 'failed'
        jobs[job_id]['error'] = str(e)
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)

def post_download_processing(job_id, temp_dir, download_type, playlist_title="download"):
    """Handles file operations after download completion."""
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
                    file_path = os.path.join(temp_dir, file)
                    zipf.write(file_path, arcname=file)
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
                full_path = os.path.abspath(os.path.join(temp_dir, file))
                safe_path = full_path.replace("'", "'\\''")
                f.write(f"file '{safe_path}'\n")

        output_filename = f"{playlist_title} (Combined).mp3"
        output_filepath = os.path.join("temp", output_filename)

        ffmpeg_path = get_ffmpeg_path()
        if not ffmpeg_path:
             raise FileNotFoundError("Could not locate the ffmpeg directory.")

        command = [os.path.join(ffmpeg_path, 'ffmpeg'), '-f', 'concat', '-safe', '0', '-i', list_file_path, '-c', 'copy', '-y', output_filepath]
        subprocess.run(command, check=True, capture_output=True, text=True)
        
        jobs[job_id].update({'file_path': output_filepath, 'file_name': output_filename, 'status': 'completed'})

def progress_hook(d):
    """Provides real-time progress updates for the job."""
    job_id = d.get('info_dict', {}).get('job_id')
    if job_id and job_id in jobs:
        if d['status'] == 'downloading':
            jobs[job_id]['status'] = 'downloading'
            jobs[job_id]['progress'] = d.get('_percent_str', '0%').replace('%','').strip()
        elif d['status'] == 'finished':
            jobs[job_id]['status'] = 'processing'

def create_job(url):
    """Initializes a new job entry."""
    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'starting', 'url': url, 'progress': '0'}
    return job_id

# --- API Endpoints ---

@app.route('/start-job', methods=['POST'])
def start_job():
    """Single endpoint to handle starting any type of download job."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid JSON request'}), 400
        
    url = data.get('url')
    job_type = data.get('jobType') 
    cookies = data.get('cookies')
    
    if not all([url, job_type]):
        return jsonify({'error': 'Missing url or jobType in request body'}), 400

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
        ydl_opts['outtmpl'] = '%(playlist_index)s - %(title)s.%(ext)s'
        ydl_opts['ignoreerrors'] = True
    else: # single_mp3
        ydl_opts['outtmpl'] = '%(title)s.%(ext)s'
        ydl_opts['noplaylist'] = True

    thread = threading.Thread(target=download_thread, args=(url, ydl_opts, job_id, job_type, cookies_path))
    thread.daemon = True 
    thread.start()
    
    return jsonify({'jobId': job_id})

@app.route('/job-status', methods=['GET'])
def get_job_status():
    job_id = request.args.get('jobId')
    if not job_id:
        return jsonify({'status': 'not_found', 'error': 'jobId parameter is missing'}), 400
    
    job = jobs.get(job_id)
    if not job:
        return jsonify({'status': 'not_found'}), 404
    return jsonify(job)

@app.route('/download/<job_id>', methods=['GET'])
def download_file(job_id):
    job = jobs.get(job_id)
    if not job or job['status'] != 'completed':
        return jsonify({'error': 'File not ready or job failed'}), 404

    file_path = job.get('file_path')
    file_name = job.get('file_name')
    temp_dir = job.get('temp_dir') 

    if not file_path or not os.path.exists(file_path):
        return jsonify({'error': 'File not found'}), 404

    def file_sender():
        try:
            with open(file_path, 'rb') as f:
                yield from f
        finally:
            if os.path.exists(file_path):
                 os.remove(file_path)
            if temp_dir and os.path.exists(temp_dir):
                 shutil.rmtree(temp_dir, ignore_errors=True)
            jobs.pop(job_id, None)

    return Response(file_sender(),
                    mimetype='application/octet-stream',
                    headers={'Content-Disposition': f'attachment;filename="{file_name}"'})


if __name__ == '__main__':
    try:
        if not os.path.exists('temp'):
            os.makedirs('temp')
            
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
        
        print(f"Flask-Backend-Ready:{port}", flush=True)
        
        app.run(host='127.0.0.1', port=port, debug=False)

    except Exception as e:
        print(f"FATAL: {e}", file=sys.stderr)
        sys.exit(1)
