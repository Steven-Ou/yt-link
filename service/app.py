import os
import sys
import logging
import json
import zipfile
import uuid
import threading
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import yt_dlp
import static_ffmpeg

# --- Basic Setup ---
static_ffmpeg.add_paths()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
app = Flask(__name__)
CORS(app)

# FIX: In-memory job store instead of Redis. This removes the external dependency.
JOBS = {}
JOBS_LOCK = threading.Lock() # To safely access the JOBS dict from multiple threads

# --- Helper Functions ---
def update_job_status(job_id, status, message=None, progress=None, download_path=None):
    """Safely updates the status of a job in the in-memory store."""
    with JOBS_LOCK:
        if job_id not in JOBS:
            JOBS[job_id] = {}
        JOBS[job_id]['status'] = status
        if message is not None:
            JOBS[job_id]['message'] = message
        if progress is not None:
            JOBS[job_id]['progress'] = progress
        if download_path is not None:
            JOBS[job_id]['downloadPath'] = download_path

def progress_hook(d, job_id):
    """A hook for yt-dlp to report download progress."""
    if d['status'] == 'downloading':
        try:
            progress = d.get('_percent_str', '0%').replace('%', '').strip()
            update_job_status(job_id, 'downloading', f"Downloading: {d.get('filename', '...')}", float(progress))
        except (ValueError, TypeError):
            pass
    elif d['status'] == 'finished':
        update_job_status(job_id, 'processing', "Download finished, post-processing...", 100)
    elif d['status'] == 'error':
        update_job_status(job_id, 'failed', "An error occurred during download.")

# --- Download Task (Runs in a separate thread) ---
def download_video_task(job_id, job_type, url, download_path, cookies_path=None):
    """This function runs in the background to download and process the video/playlist."""
    try:
        ydl_opts = {
            'cookiefile': cookies_path, 'progress_hooks': [lambda d: progress_hook(d, job_id)],
            'nocheckcertificate': True, 'ignoreerrors': True,
            'outtmpl': os.path.join(download_path, '%(title)s.%(ext)s'),
        }

        if job_type == 'single_mp3':
            ydl_opts.update({'format': 'bestaudio/best', 'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}]})
        elif job_type == 'playlist_zip':
            ydl_opts.update({'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', 'outtmpl': os.path.join(download_path, '%(playlist_index)s - %(title)s.%(ext)s')})
        elif job_type == 'combine_mp3':
            ydl_opts.update({'format': 'bestaudio/best', 'outtmpl': os.path.join(download_path, '%(title)s.%(ext)s'), 'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}]})
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        
        final_download_path = download_path
        if job_type == 'playlist_zip':
            update_job_status(job_id, 'processing', 'Zipping playlist files...')
            zip_path = f"{download_path}.zip"
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, _, files in os.walk(download_path):
                    for file in files:
                        zipf.write(os.path.join(root, file), arcname=file)
            final_download_path = os.path.dirname(zip_path)
        
        update_job_status(job_id, 'completed', 'Job completed successfully!', 100, final_download_path)

    except Exception as e:
        error_message = f"Error in download task: {str(e)}"
        logging.error(error_message, exc_info=True)
        update_job_status(job_id, 'failed', error_message)

# --- API Route Definitions ---
def start_job_handler(job_type):
    """A generic handler to validate the request and start a download thread."""
    data = request.get_json()
    url = data.get('url') or data.get('playlistUrl') or data.get('youtubeUrl')
    download_path = data.get('downloadPath')
    cookies_path = data.get('cookiesPath')
    
    if not url or not download_path:
        return jsonify({'error': 'Missing URL or downloadPath in request body'}), 400
    
    job_id = str(uuid.uuid4())
    update_job_status(job_id, 'queued', 'Download is queued and will start shortly...', 0, download_path)
    
    thread = threading.Thread(target=download_video_task, args=(job_id, job_type, url, download_path, cookies_path))
    thread.daemon = True # Allows main thread to exit even if this thread is running
    thread.start()
    
    logging.info(f"Started job {job_id} of type {job_type} in a new thread.")
    return jsonify({'jobId': job_id}), 202

@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job_route(): return start_job_handler('single_mp3')

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job_route(): return start_job_handler('playlist_zip')

@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job_route(): return start_job_handler('combine_mp3')

@app.route('/job-status', methods=['GET'])
def job_status_route():
    """Gets the status of a job from the in-memory store."""
    job_id = request.args.get('jobId')
    if not job_id:
        return jsonify({'error': 'Missing jobId parameter'}), 400
    
    with JOBS_LOCK:
        job_info = JOBS.get(job_id)

    if job_info:
        # We need to add the id to the response for the frontend
        response_data = {'id': job_id, **job_info}
        return jsonify(response_data), 200
    else:
        return jsonify({'status': 'not_found', 'message': f'Job {job_id} not found.'}), 404

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    # This print statement sends the "ready" signal to the Electron main process.
    print(f"Flask-Backend-Ready:{port}", flush=True)
    app.run(host='127.0.0.1', port=port, debug=False)
