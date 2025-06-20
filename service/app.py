import sys
import os
import shutil
import logging
import threading
import uuid
import zipfile
import stat  # Import the stat module to handle file permissions
from queue import Queue, Empty
from flask import Flask, request, jsonify, send_file, after_this_request
from flask_cors import CORS
from yt_dlp import YoutubeDL

# --- Basic Setup ---

# Configure logging to see output in the console
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Get the port from an environment variable, with a fallback for local dev
APP_PORT = int(os.environ.get('YT_LINK_BACKEND_PORT', 5001))

app = Flask(__name__)
# Allow requests from the Electron frontend
CORS(app, resources={r"/api/*": {"origins": "*"}})

# In-memory storage for job statuses and results
jobs = {}
# Queue for managing file deletions after they are sent
cleanup_queue = Queue()

# --- Core Helper Functions ---

def set_executable_permission(path):
    """Sets executable permission for a file, necessary on macOS/Linux."""
    if sys.platform != "win32":
        try:
            # Get the current permissions
            current_stat = os.stat(path)
            # Add execute permissions for user, group, and others
            os.chmod(path, current_stat.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            logging.info(f"Set executable permission for {path}")
        except Exception as e:
            logging.error(f"Failed to set executable permission for {path}: {e}")

def find_executable(name):
    """
    Finds an executable, reliably accounting for being bundled in a packaged app.
    **This version includes a fix for macOS/Linux permissions.**
    """
    resources_path = os.environ.get('YT_LINK_RESOURCES_PATH')
    
    if resources_path:
        bin_dir = os.path.join(resources_path, 'bin')
        exe_name = f"{name}.exe" if sys.platform == "win32" else name
        exe_path = os.path.join(bin_dir, exe_name)
        
        if os.path.exists(exe_path):
            logging.info(f"Found bundled executable '{name}' at: {exe_path}")
            # **CRITICAL FIX**: Ensure the binary is executable.
            set_executable_permission(exe_path)
            return exe_path
        else:
            logging.error(f"Could not find bundled '{name}' at expected path: {exe_path}")
            return None
            
    fallback_path = shutil.which(name)
    if fallback_path:
        logging.info(f"Found executable '{name}' in system PATH (dev mode): {fallback_path}")
    else:
        logging.warning(f"Could not find '{name}' in system PATH (dev mode).")
        
    return fallback_path

def get_ydl_options(output_path, playlist=False):
    """
    Gets the base options for yt-dlp, correctly specifying the ffmpeg path.
    """
    # Find both ffmpeg and ffprobe to ensure they both exist and have correct permissions.
    ffmpeg_exe_path = find_executable('ffmpeg')
    find_executable('ffprobe') # We call this to set its permission, even if we don't use the return value.

    ffmpeg_dir = None
    if ffmpeg_exe_path:
        ffmpeg_dir = os.path.dirname(ffmpeg_exe_path)
        logging.info(f"Setting ffmpeg directory for yt-dlp to: {ffmpeg_dir}")
    else:
        logging.error("FFMPEG EXECUTABLE NOT FOUND! Post-processing will fail.")

    return {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'outtmpl': {
            'default': os.path.join(output_path, '%(title)s.%(ext)s')
        },
        'noplaylist': not playlist,
        'ffmpeg_location': ffmpeg_dir, 
        'quiet': False,
        'progress_hooks': [],
        'nocheckcertificate': True,
        # Add verbose logging from yt-dlp to help debug if issues persist
        'verbose': True,
    }

def create_job(target_function, *args):
    """Creates and starts a background job."""
    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'pending', 'progress': 0, 'message': 'Job is queued.'}
    
    thread = threading.Thread(target=target_function, args=(job_id,) + args)
    thread.daemon = True
    thread.start()
    
    return job_id

# --- Target Functions for Background Jobs ---

def do_download_single_mp3(job_id, url, download_path):
    """Job: Downloads a single video to an MP3 file."""
    jobs[job_id]['status'] = 'running'
    jobs[job_id]['message'] = 'Preparing to download...'
    os.makedirs(download_path, exist_ok=True)
    
    final_file_path = [None] # Use a list to make it mutable inside the hook

    def progress_hook(d):
        if d['status'] == 'finished':
            # This hook runs when the initial download is done, before postprocessing.
            jobs[job_id]['message'] = "Download complete. Converting to MP3..."
        elif d['status'] == 'downloading':
            jobs[job_id]['progress'] = int(d['_percent_str'].strip('% '))
            jobs[job_id]['message'] = f"Downloading..."

    ydl_opts = get_ydl_options(download_path, playlist=False)
    ydl_opts['progress_hooks'] = [progress_hook]

    try:
        with YoutubeDL(ydl_opts) as ydl:
            # The extract_info call gets metadata and determines the final filename
            info_dict = ydl.extract_info(url, download=True)
            # yt-dlp now handles naming and placing the file in 'outtmpl'
            # We need to find the resulting .mp3 file
            downloaded_file = ydl.prepare_filename(info_dict)
            # The final file will have .mp3 extension after postprocessing
            base, _ = os.path.splitext(downloaded_file)
            final_mp3_path = base + '.mp3'
            
            if os.path.exists(final_mp3_path):
                 final_file_path[0] = final_mp3_path
            else:
                # Fallback if the naming is unexpected
                for file in os.listdir(download_path):
                    if file.endswith('.mp3'):
                        final_file_path[0] = os.path.join(download_path, file)
                        break

        if final_file_path[0]:
            jobs[job_id]['status'] = 'completed'
            jobs[job_id]['message'] = 'MP3 created successfully.'
            jobs[job_id]['result'] = final_file_path[0]
        else:
            raise Exception("Conversion to MP3 failed. Could not find the final file.")

    except Exception as e:
        logging.error(f"Error in job {job_id}: {e}", exc_info=True)
        jobs[job_id]['status'] = 'failed'
        jobs[job_id]['message'] = f"An error occurred during conversion: {e}"


def do_download_and_zip_playlist(job_id, url, download_path):
    """Job: Downloads all videos in a playlist to MP3 and zips them."""
    jobs[job_id]['status'] = 'running'
    jobs[job_id]['message'] = 'Preparing to download playlist...'
    
    temp_dir = os.path.join(download_path, job_id)
    os.makedirs(temp_dir, exist_ok=True)
    
    def progress_hook(d):
        if d['status'] == 'downloading':
            jobs[job_id]['progress'] = int(d['_percent_str'].strip('% '))
            jobs[job_id]['message'] = f"Downloading: {d.get('filename', '')}"
        elif d['status'] == 'finished':
            jobs[job_id]['message'] = f"Finished downloading, now converting..."

    ydl_opts = get_ydl_options(temp_dir, playlist=True)
    ydl_opts['progress_hooks'] = [progress_hook]

    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        
        jobs[job_id]['message'] = 'Download complete. Zipping files...'
        jobs[job_id]['progress'] = 100
        
        playlist_title = "playlist"
        try:
            info_dict = YoutubeDL({'quiet': True, 'extract_flat': True, 'force_generic_extractor': True}).extract_info(url, download=False)
            playlist_title = info_dict.get('title', 'playlist').replace(" ", "_")
        except Exception as e:
            logging.warning(f"Could not get playlist title: {e}")

        zip_filename = f"{playlist_title}.zip"
        zip_filepath = os.path.join(download_path, zip_filename)

        with zipfile.ZipFile(zip_filepath, 'w') as zipf:
            for root, _, files in os.walk(temp_dir):
                for file in files:
                    if file.endswith('.mp3'):
                        zipf.write(os.path.join(root, file), arcname=file)
        
        jobs[job_id]['status'] = 'completed'
        jobs[job_id]['message'] = 'Playlist zipped successfully.'
        jobs[job_id]['result'] = zip_filepath
    except Exception as e:
        logging.error(f"Error in job {job_id}: {e}", exc_info=True)
        jobs[job_id]['status'] = 'failed'
        jobs[job_id]['message'] = str(e)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# --- Flask API Endpoints ---

@app.route('/api/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    data = request.json
    url = data.get('url')
    download_path = data.get('downloadPath')
    if not url or not download_path:
        return jsonify({'error': 'Missing URL or downloadPath'}), 400
    
    job_id = create_job(do_download_single_mp3, url, download_path)
    return jsonify({'jobId': job_id})

@app.route('/api/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    data = request.json
    url = data.get('url')
    download_path = data.get('downloadPath')
    if not url or not download_path:
        return jsonify({'error': 'Missing URL or downloadPath'}), 400
    
    job_id = create_job(do_download_and_zip_playlist, url, download_path)
    return jsonify({'jobId': job_id})

@app.route('/api/job-status/<job_id>', methods=['GET'])
def get_job_status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    return jsonify(job)

@app.route('/api/download/<job_id>', methods=['GET'])
def download_result(job_id):
    job = jobs.get(job_id)
    if not job or job['status'] != 'completed':
        return jsonify({'error': 'Job not found or not completed'}), 404

    file_path = job['result']
    if not os.path.exists(file_path):
        return jsonify({'error': 'File not found on server'}), 404

    @after_this_request
    def cleanup(response):
        if file_path.endswith('.zip'):
            cleanup_queue.put(file_path)
        return response

    return send_file(file_path, as_attachment=True)

def cleanup_worker():
    """Worker thread to delete files after they have been sent."""
    while True:
        try:
            filepath = cleanup_queue.get(timeout=1)
            os.remove(filepath)
            logging.info(f"Cleaned up file: {filepath}")
        except Empty:
            continue
        except Exception as e:
            logging.error(f"Error during file cleanup: {e}")

# --- Main Execution ---

if __name__ == '__main__':
    cleanup_thread = threading.Thread(target=cleanup_worker)
    cleanup_thread.daemon = True
    cleanup_thread.start()
    
    logging.info(f"Starting Flask server on port {APP_PORT}...")
    app.run(port=APP_PORT)
