# service/app.py

import os
import sys
import uuid
import shutil
import subprocess
from flask import Flask, request, jsonify
from yt_dlp import YoutubeDL
from threading import Thread
import logging
from werkzeug.serving import make_server

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
app = Flask(__name__)
jobs = {}

# This will be the path to the 'resources' directory in the packaged app, passed from main.js.
# It will be None during local development.
resources_path = sys.argv[2] if len(sys.argv) > 2 else None

def get_ffmpeg_directory():
    """
    Determines the path to the DIRECTORY containing ffmpeg and ffprobe.
    """
    # For a packaged app, the binaries are in a 'bin' folder inside the resources path.
    if resources_path:
        packaged_bin_path = os.path.join(resources_path, 'bin')
        if os.path.isdir(packaged_bin_path):
            logging.info(f"Found ffmpeg directory for packaged app: {packaged_bin_path}")
            return packaged_bin_path
            
    # As a fallback for local development, check the root-level bin folder
    dev_bin_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bin')
    if os.path.isdir(dev_bin_path):
        logging.info(f"Found ffmpeg directory for local development: {dev_bin_path}")
        return dev_bin_path

    logging.warning("FFmpeg directory not found, will rely on system PATH.")
    return None # Return None to let yt-dlp search the system PATH

# --- Server Thread Class ---
class ServerThread(Thread):
    def __init__(self, flask_app, port):
        super().__init__()
        self.server = make_server('127.0.0.1', port, flask_app)
        self.ctx = flask_app.app_context()
        self.ctx.push()
        self.daemon = True

    def run(self):
        logging.info("Starting Flask server...")
        self.server.serve_forever()

    def shutdown(self):
        logging.info("Shutting down Flask server...")
        self.server.shutdown()

# --- Download Worker Function ---
def download_worker(job_id, ydl_opts, url, download_path, job_type, post_download_action=None):
    """A generic worker function to handle downloads and post-processing."""
    def download_hook(d):
        if d['status'] == 'downloading':
            if job_id in jobs:
                jobs[job_id].update({
                    'progress': d.get('_percent_str', jobs[job_id]['progress']),
                    'speed': d.get('_speed_str', 'N/A'), 'eta': d.get('_eta_str', 'N/A'),
                    'message': f"Downloading: {d.get('filename')}"
                })
        elif d['status'] == 'finished':
            logging.info(f"[{job_id}] Finished downloading a file, starting postprocessing.")
            if job_id in jobs:
                jobs[job_id]['status'] = 'processing'
                jobs[job_id]['message'] = "Extracting audio..."

    try:
        jobs[job_id] = {
            'status': 'downloading', 'progress': '0%', 'speed': 'N/A', 'eta': 'N/A',
            'filename': '', 'download_path': download_path, 'error': None
        }
        
        # *** THIS IS THE CORE FIX ***
        # Get the directory and pass it to yt-dlp
        ffmpeg_dir = get_ffmpeg_directory()
        if ffmpeg_dir:
            ydl_opts['ffmpeg_location'] = ffmpeg_dir
        
        ydl_opts['progress_hooks'] = [download_hook]

        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        
        if job_id in jobs:
            jobs[job_id]['status'] = 'processing'
            jobs[job_id]['message'] = 'Finalizing...'

        if post_download_action:
            final_filename = post_download_action(job_id, download_path, ydl_opts)
            jobs[job_id]['filename'] = final_filename

        jobs[job_id]['status'] = 'completed'
        jobs[job_id]['message'] = 'Job completed successfully!'
        logging.info(f"[{job_id}] Job completed successfully.")

    except Exception as e:
        logging.error(f"Error in job {job_id}: {e}", exc_info=True)
        if job_id in jobs:
            jobs[job_id]['status'] = 'failed'
            jobs[job_id]['error'] = str(e)
            jobs[job_id]['message'] = f'Error: {e}'

# --- Post-Download Action Implementations ---
def post_process_single_mp3(job_id, download_path, ydl_opts):
    """Gets the final filename for a single MP3 job."""
    with YoutubeDL(ydl_opts) as ydl:
        # Use the URL from the original options
        url = ydl_opts.get('original_url', '')
        if not url:
             raise Exception("Original URL not found in options for post-processing.")
        info_dict = ydl.extract_info(url, download=False)
        base_filename = ydl.prepare_filename(info_dict)
        final_filename = os.path.splitext(base_filename)[0] + '.mp3'
        return os.path.basename(final_filename)

def post_process_zip_playlist(job_id, download_path, ydl_opts):
    """Zips the downloaded playlist files."""
    temp_dir = os.path.dirname(ydl_opts['outtmpl']['default'])
    playlist_title = ydl_opts.get('playlist_title', f'playlist_{job_id}')
    zip_filename_base = os.path.join(download_path, playlist_title)
    
    shutil.make_archive(zip_filename_base, 'zip', temp_dir)
    shutil.rmtree(temp_dir)
    return f"{playlist_title}.zip"

def post_process_combine_playlist(job_id, download_path, ydl_opts):
    """Combines all downloaded MP3s into a single file using the correct ffmpeg path."""
    temp_dir = os.path.dirname(ydl_opts['outtmpl']['default'])
    playlist_title = ydl_opts.get('playlist_title', f'playlist_{job_id}')
    output_filename = os.path.join(download_path, f"{playlist_title} (Combined).mp3")
    
    mp3_files = sorted([f for f in os.listdir(temp_dir) if f.endswith('.mp3')])
    if not mp3_files:
        raise Exception("No MP3 files found to combine.")

    filelist_path = os.path.join(temp_dir, 'filelist.txt')
    with open(filelist_path, 'w', encoding='utf-8') as f:
        for mp3_file in mp3_files:
            # Use absolute paths for ffmpeg concat
            full_mp3_path = os.path.join(temp_dir, mp3_file).replace("'", "'\\''")
            f.write(f"file '{full_mp3_path}'\n")

    ffmpeg_dir = get_ffmpeg_directory()
    ffmpeg_exe = 'ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg'
    ffmpeg_path = os.path.join(ffmpeg_dir, ffmpeg_exe) if ffmpeg_dir else 'ffmpeg'

    ffmpeg_command = [ffmpeg_path, '-f', 'concat', '-safe', '0', '-i', filelist_path, '-c', 'copy', '-y', output_filename]
    
    logging.info(f"[{job_id}] Running ffmpeg command: {' '.join(ffmpeg_command)}")
    result = subprocess.run(ffmpeg_command, capture_output=True, text=True, encoding='utf-8')
    
    if result.returncode != 0:
        logging.error(f"[{job_id}] FFmpeg error: {result.stderr}")
        raise Exception(f"FFmpeg failed: {result.stderr}")

    shutil.rmtree(temp_dir)
    return os.path.basename(output_filename)

# --- API Endpoints ---
@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    data = request.json
    job_id = str(uuid.uuid4())
    ydl_opts = {
        'format': 'bestaudio/best', 'noplaylist': True,
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
        'outtmpl': {'default': os.path.join(data['downloadPath'], '%(title)s.%(ext)s')},
        # Store original URL for post-processing
        'original_url': data['url']
    }
    thread = Thread(target=download_worker, args=(job_id, ydl_opts, data['url'], data['downloadPath'], 'single', post_process_single_mp3))
    thread.daemon = True
    thread.start()
    return jsonify({'jobId': job_id})

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    data = request.json
    job_id = str(uuid.uuid4())
    playlist_url = data['playlistUrl']
    with YoutubeDL({'extract_flat': True, 'quiet': True}) as ydl:
        info = ydl.extract_info(playlist_url, download=False)
        playlist_title = info.get('title', f'playlist-{job_id}')
    
    temp_download_dir = os.path.join(data['downloadPath'], f"temp_{job_id}")
    os.makedirs(temp_download_dir, exist_ok=True)

    ydl_opts = {
        'format': 'bestaudio/best', 'noplaylist': False,
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
        'outtmpl': {'default': os.path.join(temp_download_dir, '%(playlist_index)s - %(title)s.%(ext)s')},
        'playlist_title': playlist_title
    }
    thread = Thread(target=download_worker, args=(job_id, ydl_opts, playlist_url, data['downloadPath'], 'playlistZip', post_process_zip_playlist))
    thread.daemon = True
    thread.start()
    return jsonify({'jobId': job_id})

@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job():
    data = request.json
    job_id = str(uuid.uuid4())
    playlist_url = data['playlistUrl']
    with YoutubeDL({'extract_flat': True, 'quiet': True}) as ydl:
        info = ydl.extract_info(playlist_url, download=False)
        playlist_title = info.get('title', f'playlist-{job_id}')

    temp_download_dir = os.path.join(data['downloadPath'], f"temp_{job_id}")
    os.makedirs(temp_download_dir, exist_ok=True)

    ydl_opts = {
        'format': 'bestaudio/best', 'noplaylist': False,
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
        'outtmpl': {'default': os.path.join(temp_download_dir, '%(playlist_index)s - %(title)s.%(ext)s')},
        'playlist_title': playlist_title
    }
    thread = Thread(target=download_worker, args=(job_id, ydl_opts, playlist_url, data['downloadPath'], 'combinePlaylist', post_process_combine_playlist))
    thread.daemon = True
    thread.start()
    return jsonify({'jobId': job_id})

@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({'status': 'not_found', 'message': 'Job not found.'}), 404
    return jsonify(job)

# --- Main Execution ---
if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    server_thread = ServerThread(app, port)
    server_thread.start()
    try:
        while True:
            pass
    except KeyboardInterrupt:
        server_thread.shutdown()
        sys.exit(0)
