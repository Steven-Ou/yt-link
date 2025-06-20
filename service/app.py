# service/app.py

import os
import sys
import uuid
from flask import Flask, request, jsonify, send_from_directory
from yt_dlp import YoutubeDL
from threading import Thread
import logging
from werkzeug.serving import make_server

# --- Logging Configuration ---
# Set up basic logging to capture info and error messages.
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Flask App Initialization ---
app = Flask(__name__)

# --- In-Memory Job Storage ---
# A dictionary to keep track of the status and details of ongoing and completed jobs.
jobs = {}

class ServerThread(Thread):
    """
    A separate thread to run the Flask server so it doesn't block the main application.
    """
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

def download_media(url, ydl_opts, job_id, download_path):
    """
    The main download function that runs in a separate thread.
    """
    # CORRECTED: The hook is now defined inside this function.
    # This creates a 'closure', giving the hook safe access to the 'job_id'.
    def download_hook(d):
        """
        A hook function called by yt-dlp to report progress.
        """
        if d['status'] == 'downloading':
            # Update progress if the job is actively downloading
            if job_id in jobs:
                jobs[job_id].update({
                    'progress': d.get('_percent_str', jobs[job_id]['progress']),
                    'speed': d.get('_speed_str', 'N/A'),
                    'eta': d.get('_eta_str', 'N/A')
                })
        elif d['status'] == 'finished':
            # Mark the download as complete before postprocessing (e.g., audio extraction)
            logging.info(f"[{job_id}] Finished download, starting postprocessing.")
            if job_id in jobs:
                jobs[job_id]['status'] = 'processing'

    try:
        # Initialize job status in our dictionary
        jobs[job_id] = {
            'status': 'downloading', 'progress': '0%', 'speed': 'N/A', 'eta': 'N/A',
            'filename': '', 'download_path': download_path, 'error': None
        }
        
        # Set the output template and the reliable progress hook
        ydl_opts['outtmpl'] = os.path.join(download_path, '%(title)s.%(ext)s')
        ydl_opts['progress_hooks'] = [download_hook]
        
        with YoutubeDL(ydl_opts) as ydl:
            # Start the download process
            ydl.download([url])
            
            # After download, get the final filename without re-downloading
            info_dict = ydl.extract_info(url, download=False)
            base_filename = ydl.prepare_filename(info_dict)
            
            # Determine the correct final filename after audio extraction
            if any(pp.get('key') == 'FFmpegExtractAudio' for pp in ydl_opts.get('postprocessors', [])):
                final_filename = os.path.splitext(base_filename)[0] + '.' + ydl_opts['postprocessors'][0]['preferredcodec']
            else:
                final_filename = base_filename

            jobs[job_id]['filename'] = os.path.basename(final_filename)

        # Mark job as completed
        jobs[job_id]['status'] = 'completed'
        logging.info(f"[{job_id}] Job completed successfully.")

    except Exception as e:
        # If an error occurs, log it and update the job status
        logging.error(f"Error in job {job_id}: {e}", exc_info=True)
        if job_id in jobs:
            jobs[job_id]['status'] = 'failed'
            jobs[job_id]['error'] = str(e)


# --- API Endpoints ---

@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    """
    API endpoint to start a download job for a single MP3.
    """
    data = request.json
    url = data['url']
    download_path = data['downloadPath']
    
    job_id = str(uuid.uuid4())
    
    # --- yt-dlp Options for Single MP3 ---
    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
    }

    # Start the download in a new thread
    thread = Thread(target=download_media, args=(url, ydl_opts, job_id, download_path))
    thread.daemon = True
    thread.start()
    
    return jsonify({'jobId': job_id})

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    return jsonify({'error': 'Not implemented yet'}), 501
    
@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job():
    return jsonify({'error': 'Not implemented yet'}), 501

@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    return jsonify(job)

@app.route('/download-file/<job_id>', methods=['GET'])
def download_file(job_id):
    job = jobs.get(job_id)
    if not job or job['status'] != 'completed':
        return jsonify({'error': 'File not ready or job not found'}), 404
        
    directory = job['download_path']
    filename = job['filename']
    
    if not os.path.exists(os.path.join(directory, filename)):
        return jsonify({'error': f'File not found on server: {filename}'}), 404
        
    return send_from_directory(directory, filename, as_attachment=True)


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
