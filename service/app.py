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
    Determines the correct path for the ffmpeg executable based on the OS
    and whether the app is running in a packaged (frozen) state.
    """
    base_path = ""
    # Check if the application is running in a bundled executable
    if getattr(sys, 'frozen', False):
        base_path = os.path.dirname(sys.executable)
    else:
        base_path = os.path.dirname(os.path.abspath(__file__))

    ffmpeg_exe = "ffmpeg.exe" if platform.system() == "Windows" else "ffmpeg"
    
    # Path when running from the 'service' directory
    ffmpeg_path = os.path.join(base_path, "ffmpeg", "bin", ffmpeg_exe)
    
    # Fallback for different CWD
    if not os.path.exists(ffmpeg_path):
         ffmpeg_path = os.path.join(os.getcwd(), "service", "ffmpeg", "bin", ffmpeg_exe)

    if os.path.exists(ffmpeg_path):
        return ffmpeg_path
        
    # Final fallback to system's PATH
    return "ffmpeg"

def create_cookie_file(job_id, cookies_string):
    """Creates a temporary cookie file from a string to pass to yt-dlp."""
    if not cookies_string or not cookies_string.strip():
        return None
    
    cookie_dir = os.path.join('temp', str(job_id))
    os.makedirs(cookie_dir, exist_ok=True)
    
    cookie_file_path = os.path.join(cookie_dir, 'cookies.txt')
    
    # yt-dlp requires the Netscape HTTP Cookie File format header
    header = "# Netscape HTTP Cookie File"
    if not cookies_string.lstrip().startswith(header):
        cookies_string = f"{header}\n{cookies_string}"
        
    with open(cookie_file_path, 'w', encoding='utf-8') as f:
        f.write(cookies_string)
        
    return cookie_file_path

# --- Core Download Logic ---

def download_thread(url, ydl_opts, job_id, download_type, cookies_path):
    """
    This function runs in a separate thread to handle the download process
    without blocking the main server. It now includes robust cleanup.
    """
    temp_dir = os.path.join("temp", str(job_id))
    os.makedirs(temp_dir, exist_ok=True)
    
    jobs[job_id]['temp_dir'] = temp_dir
    ydl_opts['outtmpl'] = os.path.join(temp_dir, ydl_opts['outtmpl'])

    # Add cookie file to options if it was created
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
        print(f"Error in download_thread for job {job_id}: {e}", file=sys.stderr)
        jobs[job_id]['status'] = 'failed'
        jobs[job_id]['error'] = str(e)
    finally:
        # On failure, ensure the temporary directory is removed
        if jobs.get(job_id, {}).get('status') != 'completed':
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)

def post_download_processing(job_id, temp_dir, download_type, playlist_title="download"):
    """
    Handles file operations after the download is complete, such as zipping
    or combining files.
    """
    try:
        if download_type == "single_mp3":
            files = os.listdir(temp_dir)
            mp3_files = [f for f in files if f.endswith('.mp3')]
            if mp3_files:
                file_path = os.path.join(temp_dir, mp3_files[0])
                jobs[job_id]['file_path'] = file_path
                jobs[job_id]['file_name'] = os.path.basename(file_path)
                jobs[job_id]['status'] = 'completed'
            else:
                raise FileNotFoundError("MP3 conversion failed. The MP3 file was not created.")

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
            
            if mp3_files_found:
                jobs[job_id]['file_path'] = zip_path
                jobs[job_id]['file_name'] = zip_filename
                jobs[job_id]['status'] = 'completed'
                shutil.rmtree(temp_dir, ignore_errors=True)
            else:
                raise FileNotFoundError("No MP3 files were created for the playlist.")
        
        elif download_type == "combine_playlist_mp3":
            # FIX: Sort files numerically based on the playlist index prefix.
            mp3_files = sorted(
                [f for f in os.listdir(temp_dir) if f.endswith('.mp3')],
                key=lambda x: int(x.split(' ')[0]) if x.split(' ')[0].isdigit() else 0
            )

            if not mp3_files:
                raise FileNotFoundError("No MP3 files were downloaded to combine.")

            list_file_path = os.path.join(temp_dir, 'filelist.txt')
            with open(list_file_path, 'w', encoding='utf-8') as f:
                for file in mp3_files:
                    full_path = os.path.abspath(os.path.join(temp_dir, file))
                    f.write(f"file '{full_path.replace(\"'\", \"'\\\\''\")}'\n")

            output_filename = f"{playlist_title} (Combined).mp3"
            output_filepath = os.path.join("temp", output_filename)

            command = [
                get_ffmpeg_path(), '-f', 'concat', '-safe', '0', 
                '-i', list_file_path, '-c', 'copy', '-y', output_filepath
            ]

            subprocess.run(command, check=True, capture_output=True, text=True)
            
            jobs[job_id]['file_path'] = output_filepath
            jobs[job_id]['file_name'] = output_filename
            jobs[job_id]['status'] = 'completed'
            shutil.rmtree(temp_dir, ignore_errors=True)

    except Exception as e:
        print(f"Error in post_download_processing for job {job_id}: {e}", file=sys.stderr)
        jobs[job_id]['status'] = 'failed'
        jobs[job_id]['error'] = str(e)


def progress_hook(d):
    """This hook provides real-time progress updates for the job."""
    job_id = d['info_dict'].get('job_id')
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
    job_type = data.get('jobType') # e.g., 'single_mp3', 'playlist_zip'
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
    thread.daemon = True # Allows main thread to exit even if downloads are running
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
    if not file_path or not os.path.exists(file_path):
        return jsonify({'error': 'File not found'}), 404

    def file_sender():
        try:
            with open(file_path, 'rb') as f:
                yield from f
        finally:
            os.remove(file_path)
            jobs.pop(job_id, None)

    return Response(file_sender(),
                    mimetype='application/octet-stream',
                    headers={'Content-Disposition': f'attachment;filename="{file_name}"'})


if __name__ == '__main__':
    try:
        if not os.path.exists('temp'):
            os.makedirs('temp')
            
        # Get port from command line arguments, default to 5001
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
        
        # CRITICAL: This print statement is the signal your Electron app is waiting for.
        print(f"Flask-Backend-Ready:{port}", flush=True)
        
        # Run the app, listening only on localhost
        app.run(host='127.0.0.1', port=port, debug=False)

    except Exception as e:
        # Log any startup errors to stderr for the Electron process to catch
        print(f"FATAL: {e}", file=sys.stderr)
        sys.exit(1)
