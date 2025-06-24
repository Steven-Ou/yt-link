import os
import sys
import logging
import json
import zipfile
import uuid
import threading
import subprocess
import shutil
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import yt_dlp

# --- Basic Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
app = Flask(__name__)
CORS(app)

# In-memory job store instead of Redis.
JOBS = {}
JOBS_LOCK = threading.Lock()

# --- Helper Functions ---

def get_ffmpeg_path():
    """Determines the path to the ffmpeg executable directory."""
    if getattr(sys, 'frozen', False):
        base_path = os.path.dirname(sys.executable)
        # In the packaged app, ffmpeg is in a sibling 'bin' directory to the 'backend' dir
        return os.path.join(base_path, '..', 'bin')
    else:
        # In development, it's in the root 'bin' directory
        base_path = os.path.dirname(os.path.abspath(__file__))
        return os.path.join(base_path, '..', 'bin')

def update_job_status(job_id, status, message=None, progress=None, download_path=None):
    """Safely updates the status of a job in the in-memory store."""
    with JOBS_LOCK:
        if job_id not in JOBS:
            JOBS[job_id] = {}
        JOBS[job_id]['status'] = status
        if message is not None:
            JOBS[job_id]['message'] = message
            logging.info(f"JOB {job_id}: {message}") # Log status updates
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
        update_job_status(job_id, 'processing', "Download finished, post-processing...")

# --- Download Task (Runs in a separate thread) ---
def download_video_task(job_id, job_type, url, download_path, cookies_path=None):
    """This function runs in the background to download and process the video/playlist."""
    try:
        # --- Single MP3 Download ---
        if job_type == 'single_mp3':
            ydl_opts = {
                'ffmpeg_location': get_ffmpeg_path(),
                'cookiefile': cookies_path, 'progress_hooks': [lambda d: progress_hook(d, job_id)],
                'nocheckcertificate': True, 'ignoreerrors': True,
                'outtmpl': os.path.join(download_path, '%(title)s.%(ext)s'), # Download with original ext first
                'format': 'bestaudio/best',
                # FIX: Use a two-step post-processor to ensure a clean MP3
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }, {
                    'key': 'FFmpegMetadata',
                    'add_metadata': True,
                }],
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
            update_job_status(job_id, 'completed', 'Job completed successfully!', 100, download_path)

        # --- Playlist to ZIP Download ---
        elif job_type == 'playlist_zip':
            info_dict = yt_dlp.YoutubeDL({'ignoreerrors': True, 'extract_flat': True}).extract_info(url, download=False)
            playlist_title = info_dict.get('title', f"playlist_{job_id}")
            playlist_folder = os.path.join(download_path, playlist_title)
            os.makedirs(playlist_folder, exist_ok=True)
            ydl_opts = {
                'ffmpeg_location': get_ffmpeg_path(),
                'cookiefile': cookies_path, 'progress_hooks': [lambda d: progress_hook(d, job_id)],
                'nocheckcertificate': True, 'ignoreerrors': True,
                # FIX: This format string plus the post-processor ensures audio/video are merged
                'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                'outtmpl': os.path.join(playlist_folder, '%(playlist_index)s - %(title)s.%(ext)s'),
                'postprocessors': [{'key': 'FFmpegVideoConvertor', 'preferedformat': 'mp4'}]
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
            update_job_status(job_id, 'processing', f"Zipping folder: {playlist_title}...")
            zip_path = os.path.join(download_path, f"{playlist_title}.zip")
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, _, files in os.walk(playlist_folder):
                    for file in files:
                        full_path = os.path.join(root, file)
                        zipf.write(full_path, os.path.relpath(full_path, playlist_folder))
            shutil.rmtree(playlist_folder)
            update_job_status(job_id, 'completed', 'Playlist successfully zipped!', 100, download_path)

        # --- Combine Playlist to single MP3 ---
        elif job_type == 'combine_mp3':
            info_dict = yt_dlp.YoutubeDL({'ignoreerrors': True, 'extract_flat': True}).extract_info(url, download=False)
            playlist_title = info_dict.get('title', f"combined_{job_id}")
            temp_dir = os.path.join(download_path, f"temp_combine_{job_id}")
            os.makedirs(temp_dir, exist_ok=True)
            ydl_opts_download = {
                'ffmpeg_location': get_ffmpeg_path(),
                'cookiefile': cookies_path, 'progress_hooks': [lambda d: progress_hook(d, job_id)],
                'nocheckcertificate': True, 'ignoreerrors': True,
                'format': 'bestaudio/best',
                # Download as wav for stable concatenation
                'outtmpl': os.path.join(temp_dir, '%(playlist_index)03d_%(id)s.%(ext)s'),
                'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'wav'}]
            }
            with yt_dlp.YoutubeDL(ydl_opts_download) as ydl:
                ydl.download([url])
            update_job_status(job_id, 'processing', 'Combining audio files...')
            wav_files = sorted([os.path.join(temp_dir, f) for f in os.listdir(temp_dir) if f.endswith('.wav')])
            if not wav_files:
                raise Exception("No audio files were downloaded to combine.")
            list_file_path = os.path.join(temp_dir, 'concat_list.txt')
            with open(list_file_path, 'w', encoding='utf-8') as f:
                for wav_file in wav_files:
                    safe_path = wav_file.replace("'", "'\\''")
                    f.write(f"file '{safe_path}'\n")
            output_mp3_path = os.path.join(download_path, f"{playlist_title} (Combined).mp3")
            ffmpeg_executable = os.path.join(get_ffmpeg_path(), 'ffmpeg')
            # FIX: Use a robust ffmpeg command to concatenate and convert to MP3
            command = [
                ffmpeg_executable, '-y',
                '-f', 'concat', '-safe', '0', '-i', list_file_path,
                '-ab', '192k', # Set audio bitrate for MP3
                output_mp3_path
            ]
            result = subprocess.run(command, capture_output=True, text=True)
            if result.returncode != 0:
                logging.error(f"FFMPEG Error: {result.stderr}")
                raise Exception("FFMPEG failed to combine files.")
            shutil.rmtree(temp_dir)
            update_job_status(job_id, 'completed', 'Playlist successfully combined!', 100, download_path)

    except Exception as e:
        error_message = f"Error in download task: {str(e)}"
        logging.error(error_message, exc_info=True)
        update_job_status(job_id, 'failed', error_message)

# --- API Route Definitions ---
def start_job_handler(job_type):
    data = request.get_json()
    url = data.get('url') or data.get('playlistUrl') or data.get('youtubeUrl')
    download_path = data.get('downloadPath')
    cookies_path = data.get('cookiesPath')
    if not url or not download_path:
        return jsonify({'error': 'Missing URL or downloadPath in request body'}), 400
    job_id = str(uuid.uuid4())
    update_job_status(job_id, 'queued', 'Download is queued and will start shortly...', 0, download_path)
    thread = threading.Thread(target=download_video_task, args=(job_id, job_type, url, download_path, cookies_path))
    thread.daemon = True
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
    job_id = request.args.get('jobId')
    if not job_id:
        return jsonify({'error': 'Missing jobId parameter'}), 400
    with JOBS_LOCK:
        job_info = JOBS.get(job_id)
    if job_info:
        response_data = {'id': job_id, **job_info}
        return jsonify(response_data), 200
    else:
        return jsonify({'status': 'not_found', 'message': f'Job {job_id} not found.'}), 404

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    print(f"Flask-Backend-Ready:{port}", flush=True)
    app.run(host='127.0.0.1', port=port, debug=False)
