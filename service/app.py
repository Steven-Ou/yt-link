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
# This is a simple solution for this example; for a production app, you might use a database.
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
        self.daemon = True # Allows the main application to exit even if this thread is running

    def run(self):
        logging.info("Starting Flask server...")
        self.server.serve_forever()

    def shutdown(self):
        logging.info("Shutting down Flask server...")
        self.server.shutdown()

def download_hook(d):
    """
    A hook function called by yt-dlp during the download process.
    Updates the job status with progress information.
    """
    job_id = d.get('info_dict', {}).get('id')
    if job_id and job_id in jobs:
        if d['status'] == 'downloading':
            # Update progress if the job is actively downloading
            jobs[job_id]['progress'] = d['_percent_str']
            jobs[job_id]['speed'] = d.get('_speed_str', 'N/A')
            jobs[job_id]['eta'] = d.get('_eta_str', 'N/A')
        elif d['status'] == 'finished':
            # Mark the download as complete before postprocessing (e.g., audio extraction)
            logging.info(f"[{job_id}] Finished download, starting postprocessing.")
            jobs[job_id]['status'] = 'processing'

def download_media(url, ydl_opts, job_id, download_path):
    """
    The main download function that runs in a separate thread.
    """
    try:
        # Update job status to 'downloading'
        jobs[job_id] = {
            'status': 'downloading',
            'progress': '0%',
            'speed': 'N/A',
            'eta': 'N/A',
            'filename': '',
            'download_path': download_path,
            'error': None
        }
        
        # Add the job_id to the options so it's available in the download_hook
        ydl_opts['outtmpl']['default'] = os.path.join(download_path, '%(title)s.%(ext)s')
        ydl_opts['progress_hooks'] = [download_hook]
        
        with YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=True)
            # Store the final filename after download and processing
            final_filename = ydl.prepare_filename(info_dict)
            # Adjust the extension if it was converted (e.g., to mp3)
            if 'postprocessors' in ydl_opts and any(pp['key'] == 'FFmpegExtractAudio' for pp in ydl_opts['postprocessors']):
                final_filename = os.path.splitext(final_filename)[0] + '.mp3'

            jobs[job_id]['filename'] = os.path.basename(final_filename)

        # Mark the job as completed successfully
        jobs[job_id]['status'] = 'completed'
        logging.info(f"[{job_id}] Job completed successfully.")

    except Exception as e:
        # If an error occurs, log it and update the job status
        logging.error(f"Error in job {job_id}: {e}")
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
    
    job_id = str(uuid.uuid4()) # Generate a unique ID for this job
    
    # --- yt-dlp Options for Single MP3 ---
    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,  # <-- THE FIX: This prevents downloading the whole playlist.
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'outtmpl': {}, # Placeholder, will be filled in by download_media
        'id': job_id   # Pass job_id to be used in hooks
    }

    # Start the download in a new thread to avoid blocking the API response
    thread = Thread(target=download_media, args=(url, ydl_opts, job_id, download_path))
    thread.daemon = True
    thread.start()
    
    return jsonify({'jobId': job_id})

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    # Placeholder for playlist zip functionality
    return jsonify({'error': 'Not implemented yet'}), 501
    
@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job():
    # Placeholder for combining playlist mp3s
    return jsonify({'error': 'Not implemented yet'}), 501

@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status(job_id):
    """
    API endpoint to check the status of a specific job.
    """
    job = jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    return jsonify(job)

@app.route('/download-file/<job_id>', methods=['GET'])
def download_file(job_id):
    """
    API endpoint to download the completed file.
    """
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
    # Get port from command-line arguments, default to 5001 if not provided
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    
    # Run Flask in a separate thread
    server_thread = ServerThread(app, port)
    server_thread.start()
    
    try:
        # Keep the main thread alive
        while True:
            pass
    except KeyboardInterrupt:
        # Handle Ctrl+C to gracefully shut down the server
        server_thread.shutdown()
        sys.exit(0)
