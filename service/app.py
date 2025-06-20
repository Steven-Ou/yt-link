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

def get_ffmpeg_path():
    """
    Determines the path to the ffmpeg executable.
    In a packaged app, it looks inside the bundled 'bin' directory.
    In development, it assumes ffmpeg is in the system's PATH.
    """
    if resources_path:
        ffmpeg_executable = 'ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg'
        # Correctly join the paths
        return os.path.join(resources_path, 'bin', ffmpeg_executable)
    # For local development, rely on ffmpeg being in the system's PATH
    return 'ffmpeg'

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
        
        # Set ffmpeg location for yt-dlp to use for post-processing
        ydl_opts['ffmpeg_location'] = get_ffmpeg_path()
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
        info_dict = ydl.extract_info(ydl_opts['final_url'], download=False)
        base_filename = ydl.prepare_filename(info_dict)
        final_filename = os.path.splitext(base_filename)[0] + '.mp3'
        return os.path.basename(final_filename)

def post_process_zip_playlist(job_id, download_path, ydl_opts):
    """Zips the downloaded playlist files."""
    temp_dir = os.path.dirname(ydl_opts['outtmpl']['default'])
    playlist_title = ydl_opts['playlist_title']
    zip_filename_base = os.path.join(download_path, playlist_title)
    
    shutil.make_archive(zip_filename_base, 'zip', temp_dir)
    shutil.rmtree(temp_dir)
    return f"{playlist_title}.zip"

def post_process_combine_playlist(job_id, download_path, ydl_opts):
    """Combines all downloaded MP3s into a single file using the correct ffmpeg path."""
    temp_dir = os.path.dirname(ydl_opts['outtmpl']['default'])
    playlist_title = ydl_opts['playlist_title']
    output_filename = os.path.join(download_path, f"{playlist_title} (Combined).mp3")
    
    mp3_files = sorted([f for f in os.listdir(temp_dir) if f.endswith('.mp3')])
    if not mp3_files:
        raise Exception("No MP3 files found to combine.")

    filelist_path = os.path.join(temp_dir, 'filelist.txt')
    with open(filelist_path, 'w', encoding='utf-8') as f:
        for mp3_file in mp3_files:
            f.write(f"file '{os.path.join(temp_dir, mp3_file)}'\n")

    ffmpeg_path = get_ffmpeg_path()
    ffmpeg_command = [ffmpeg_path, '-f', 'concat', '-safe', '0', '-i', filelist_path, '-c', 'copy', output_filename]
    
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
        'final_url': data['url']
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
