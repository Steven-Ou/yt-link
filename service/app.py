import os
import sys
import uuid
import logging
from flask import Flask, request, jsonify, send_from_directory
from threading import Thread
from yt_dlp import YoutubeDL
from utils.utils import find_executable

# Configure logging
logging.basicConfig(level=logging.INFO, stream=sys.stdout, format='%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s')

# Find required executables
YTDLP_PATH = find_executable('yt-dlp')
FFMPEG_PATH = find_executable('ffmpeg')

# --- Flask App Initialization ---
app = Flask(__name__)

# --- In-memory Job Store ---
jobs = {}

# --- Helper Functions ---
def download_thread(job_id, video_url, is_playlist, is_zip, cookie_file_content):
    """
    Handles the download process in a separate thread.
    Updates the job status in the 'jobs' dictionary.
    """
    jobs[job_id] = {'status': 'starting', 'progress': 0, 'error': None}
    
    # Create a temporary cookie file if content is provided
    cookie_file = None
    if cookie_file_content:
        cookie_file = f'cookies_{job_id}.txt'
        with open(cookie_file, 'w') as f:
            f.write(cookie_file_content)
            
    # Set download options
    download_path = os.path.join(os.path.expanduser('~'), 'Downloads', job_id)
    os.makedirs(download_path, exist_ok=True)
    
    output_template = os.path.join(download_path, '%(title)s.%(ext)s')

    def progress_hook(d):
        if d['status'] == 'downloading':
            percent_str = d.get('_percent_str', '0%').replace('%', '')
            try:
                jobs[job_id]['progress'] = float(percent_str)
            except (ValueError, TypeError):
                jobs[job_id]['progress'] = 0 # Or some other default
            jobs[job_id]['status'] = 'downloading'
        elif d['status'] == 'finished':
            jobs[job_id]['status'] = 'processing'
            jobs[job_id]['progress'] = 100

    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': output_template,
        'progress_hooks': [progress_hook],
        'ffmpeg_location': FFMPEG_PATH,
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
        'cookiefile': cookie_file,
        'nocheckcertificate': True,
        'ignoreerrors': True,
        'quiet': True,
        'no_warnings': True,
    }

    try:
        jobs[job_id]['status'] = 'downloading'
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])
        jobs[job_id]['status'] = 'completed'
    except Exception as e:
        jobs[job_id]['status'] = 'error'
        jobs[job_id]['error'] = str(e)
        logging.error(f"Error in download thread for job {job_id}: {e}")
    finally:
        # Clean up cookie file
        if cookie_file and os.path.exists(cookie_file):
            os.remove(cookie_file)


# --- API Endpoints ---
@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    # ADDED THIS PRINT STATEMENT FOR DEBUGGING
    print("--- Received request at /start-single-mp3-job ---", flush=True)
    
    data = request.get_json()
    video_url = data.get('videoUrl')
    cookie_file_content = data.get('cookieFileContent')
    
    if not video_url:
        return jsonify({'error': 'videoUrl is required'}), 400
        
    job_id = str(uuid.uuid4())
    
    thread = Thread(target=download_thread, args=(job_id, video_url, False, False, cookie_file_content))
    thread.start()
    
    return jsonify({'jobId': job_id})

@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status(job_id):
    job = jobs.get(job_id)
    if job:
        return jsonify(job)
    return jsonify({'error': 'Job not found'}), 404
    
# Serve downloaded files
@app.route('/files/<job_id>/<filename>')
def serve_file(job_id, filename):
    directory = os.path.join(os.path.expanduser('~'), 'Downloads', job_id)
    return send_from_directory(directory, filename, as_attachment=True)
    
# --- Main Execution ---
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)
