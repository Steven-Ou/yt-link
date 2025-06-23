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

# --- Configuration (As per your original file) ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
app = Flask(__name__)
jobs = {}

# --- FFMPEG PATHING: THE BUG FIX, Part 1 ---
# This code was added to receive the application's resource path from main.js.
# This is the first and most critical step.
base_path_for_bins = sys.argv[2] if len(sys.argv) > 2 else None
logging.info(f"Received resources_path on startup: {base_path_for_bins}")

def get_ffmpeg_directory():
    """
    This function was added to locate the `ffmpeg` binaries.
    It checks the path from main.js first, then checks a local dev path.
    """
    # For a packaged app, the binaries are in a 'bin' folder inside the resources path.
    if base_path_for_bins:
        packaged_bin_path = os.path.join(base_path_for_bins, 'bin')
        if os.path.isdir(packaged_bin_path):
            logging.info(f"Found ffmpeg directory for packaged app: {packaged_bin_path}")
            return packaged_bin_path
            
    # Fallback for local development
    dev_bin_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bin')
    if os.path.isdir(dev_bin_path):
        logging.info(f"Found ffmpeg directory for local development: {dev_bin_path}")
        return dev_bin_path

    logging.warning("FFmpeg directory not found in packaged app or dev folder. Will rely on system PATH.")
    return None

# --- Server Thread Class (Restored from your original file) ---
# This entire class was restored to ensure the Flask server runs correctly.
class ServerThread(Thread):
    def __init__(self, flask_app, port):
        super().__init__()
        self.server = make_server('127.0.0.1', port, flask_app)
        self.ctx = flask_app.app_context()
        self.ctx.push()
        self.daemon = True

    def run(self):
        logging.info(f"Starting Flask server on port {self.server.port}...")
        self.server.serve_forever()

    def shutdown(self):
        logging.info("Shutting down Flask server...")
        self.server.shutdown()

# --- Download Worker Function (Restored from your original file and fixed) ---
def download_worker(job_id, ydl_opts, url, download_path, job_type, post_download_action=None):
    """A generic worker function to handle downloads and post-processing."""
    def download_hook(d):
        if d['status'] == 'downloading':
            if job_id in jobs:
                jobs[job_id].update({
                    'status': 'downloading',
                    'progress': d.get('_percent_str', 'N/A'),
                    'speed': d.get('_speed_str', 'N/A'), 'eta': d.get('_eta_str', 'N/A'),
                    'message': 'Downloading...'
                })
        elif d['status'] == 'finished':
            logging.info(f"[{job_id}] Finished downloading a file, starting postprocessing.")
            if job_id in jobs:
                jobs[job_id]['status'] = 'processing'
                jobs[job_id]['message'] = "Extracting audio..."

    try:
        jobs[job_id] = {
            'status': 'starting', 'progress': '0%', 'message': 'Initializing job...'
        }
        
        # --- FFMPEG PATHING: THE BUG FIX, Part 2 ---
        # This is where we tell yt-dlp where to find the ffmpeg binaries.
        # This is the second critical step.
        ffmpeg_dir = get_ffmpeg_directory()
        if ffmpeg_dir:
            ydl_opts['ffmpeg_location'] = ffmpeg_dir
        
        ydl_opts['progress_hooks'] = [download_hook]

        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        
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
        jobs[job_id]['status'] = 'failed'
        jobs[job_id]['error'] = str(e)

# --- Post-Download Actions (Restored from your original file) ---
# All three of your post-processing functions have been restored.
def post_process_single_mp3(job_id, download_path, ydl_opts):
    with YoutubeDL(ydl_opts) as ydl:
        info_dict = ydl.extract_info(ydl_opts.get('original_url'), download=False)
        base_filename = ydl.prepare_filename(info_dict)
        final_filename = os.path.splitext(base_filename)[0] + '.mp3'
        return os.path.basename(final_filename)

def post_process_zip_playlist(job_id, download_path, ydl_opts):
    temp_dir = os.path.dirname(ydl_opts['outtmpl']['default'])
    playlist_title = ydl_opts.get('playlist_title', f'playlist_{job_id}')
    zip_filename_base = os.path.join(download_path, playlist_title)
    shutil.make_archive(zip_filename_base, 'zip', temp_dir)
    shutil.rmtree(temp_dir)
    return f"{playlist_title}.zip"

def post_process_combine_playlist(job_id, download_path, ydl_opts):
    temp_dir = os.path.dirname(ydl_opts['outtmpl']['default'])
    playlist_title = ydl_opts.get('playlist_title', f'playlist_{job_id}')
    output_filename = os.path.join(download_path, f"{playlist_title} (Combined).mp3")
    
    mp3_files = sorted([f for f in os.listdir(temp_dir) if f.endswith('.mp3')])
    if not mp3_files: raise Exception("No MP3 files found to combine.")

    filelist_path = os.path.join(temp_dir, 'filelist.txt')
    with open(filelist_path, 'w', encoding='utf-8') as f:
        for mp3_file in mp3_files:
            full_mp3_path = os.path.join(temp_dir, mp3_file).replace("'", "'\\''")
            f.write(f"file '{full_mp3_path}'\n")

    # --- FFMPEG PATHING: THE BUG FIX, Part 3 ---
    # This was added to find the full path to the ffmpeg executable
    # so the direct subprocess call works in a packaged app. This is the third critical step.
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

# --- API Endpoints (Restored from your original file) ---
# All three of your API endpoints for starting jobs have been restored.
@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    data = request.json
    job_id = str(uuid.uuid4())
    ydl_opts = {
        'format': 'bestaudio/best', 'noplaylist': True,
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
        'outtmpl': {'default': os.path.join(data['downloadPath'], '%(title)s.%(ext)s')},
        'original_url': data['url']
    }
    thread = Thread(target=download_worker, args=(job_id, ydl_opts, data['url'], data['downloadPath'], 'single', post_process_single_mp3))
    thread.daemon = True; thread.start()
    return jsonify({'jobId': job_id})

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    data = request.json
    job_id = str(uuid.uuid4())
    with YoutubeDL({'extract_flat': True, 'quiet': True}) as ydl:
        info = ydl.extract_info(data['playlistUrl'], download=False)
        playlist_title = info.get('title', f'playlist-{job_id}')
    
    temp_dir = os.path.join(data['downloadPath'], f"temp_{job_id}"); os.makedirs(temp_dir, exist_ok=True)
    ydl_opts = {
        'format': 'bestaudio/best', 'noplaylist': False,
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
        'outtmpl': {'default': os.path.join(temp_dir, '%(playlist_index)s - %(title)s.%(ext)s')},
        'playlist_title': playlist_title
    }
    thread = Thread(target=download_worker, args=(job_id, ydl_opts, data['playlistUrl'], data['downloadPath'], 'playlistZip', post_process_zip_playlist))
    thread.daemon = True; thread.start()
    return jsonify({'jobId': job_id})

@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job():
    data = request.json
    job_id = str(uuid.uuid4())
    with YoutubeDL({'extract_flat': True, 'quiet': True}) as ydl:
        info = ydl.extract_info(data['playlistUrl'], download=False)
        playlist_title = info.get('title', f'playlist-{job_id}')

    temp_dir = os.path.join(data['downloadPath'], f"temp_{job_id}"); os.makedirs(temp_dir, exist_ok=True)
    ydl_opts = {
        'format': 'bestaudio/best', 'noplaylist': False,
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
        'outtmpl': {'default': os.path.join(temp_dir, '%(playlist_index)s - %(title)s.%(ext)s')},
        'playlist_title': playlist_title
    }
    thread = Thread(target=download_worker, args=(job_id, ydl_opts, data['playlistUrl'], data['downloadPath'], 'combinePlaylist', post_process_combine_playlist))
    thread.daemon = True; thread.start()
    return jsonify({'jobId': job_id})

@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status(job_id):
    job = jobs.get(job_id)
    if not job: return jsonify({'status': 'not_found', 'message': 'Job not found.'}), 404
    return jsonify(job)

# --- Main Execution (Restored from your original file) ---
if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    server_thread = ServerThread(app, port)
    server_thread.start()
    try:
        # Keep the main thread alive
        while True: pass
    except KeyboardInterrupt:
        server_thread.shutdown()
        sys.exit(0)
