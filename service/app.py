# Imports the 'os' module for interacting with the operating system, like file paths.
import os
# Imports the 'sys' module for accessing system-specific parameters and functions, like command-line arguments.
import sys
# Imports the 'uuid' module for generating unique identifiers for jobs.
import uuid
# Imports the 'shutil' module for high-level file operations like creating zip archives and removing directories.
import shutil
# Imports the 'subprocess' module to run external commands, specifically for calling ffmpeg directly.
import subprocess
# Imports the necessary components from the Flask web framework to create the API.
from flask import Flask, request, jsonify
# Imports the main class from the 'yt_dlp' library to handle YouTube downloads.
from yt_dlp import YoutubeDL
# Imports the 'Thread' class to run download tasks in the background without freezing the app.
from threading import Thread
# Imports the 'logging' module to record information and errors during runtime.
import logging
# Imports 'make_server' from werkzeug to create a production-ready web server for the Flask app.
from werkzeug.serving import make_server

# --- Configuration ---
# Sets up the basic configuration for logging, so messages are printed to the console.
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
# Creates an instance of the Flask application.
app = Flask(__name__)
# Initializes an empty dictionary to store the status of all download jobs.
jobs = {}

# --- FFMPEG PATHING: THE BUG FIX, Part 1 ---
# Retrieves the third command-line argument (index 2) passed from main.js. This is the path to the app's 'resources' directory.
base_path_for_bins = sys.argv[2] if len(sys.argv) > 2 else None
# Logs the path received from main.js for debugging purposes.
logging.info(f"Received resources_path on startup: {base_path_for_bins}")

# Defines a function to locate the directory containing the ffmpeg binaries.
def get_ffmpeg_directory():
    """
    Locates the directory containing the ffmpeg and ffprobe binaries.
    This function is essential for the packaged application to find its tools.
    """
    # Checks if a resources path was provided by main.js (meaning the app is packaged).
    if base_path_for_bins:
        # Constructs the full path to the 'bin' folder inside the resources directory.
        packaged_bin_path = os.path.join(base_path_for_bins, 'bin')
        # Checks if this directory actually exists.
        if os.path.isdir(packaged_bin_path):
            # Logs the path that was found.
            logging.info(f"Found ffmpeg directory for packaged app: {packaged_bin_path}")
            # Returns the path to the 'bin' directory.
            return packaged_bin_path
            
    # If not in a packaged app, provides a fallback for local development.
    # It constructs a path by going up two directories from this file (service/app.py -> root) and then into 'bin'.
    dev_bin_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'bin')
    # Checks if this local development 'bin' directory exists.
    if os.path.isdir(dev_bin_path):
        # Logs the local path that was found.
        logging.info(f"Found ffmpeg directory for local development: {dev_bin_path}")
        # Returns the path to the local 'bin' directory.
        return dev_bin_path

    # If neither the packaged path nor the dev path is found, logs a warning.
    logging.warning("FFmpeg directory not found in packaged app or dev folder. Will rely on system PATH.")
    # Returns 'None' so that yt-dlp will attempt to find ffmpeg in the system's PATH variable as a last resort.
    return None

# --- Server Thread Class ---
# Defines a custom Thread class to run the Flask web server in the background.
class ServerThread(Thread):
    # The initializer for the class. It takes the Flask app instance and a port number.
    def __init__(self, flask_app, port):
        # Calls the parent Thread class's initializer.
        super().__init__()
        # Creates a production-grade web server instance.
        self.server = make_server('127.0.0.1', port, flask_app)
        # Gets the application context, which is needed for the server to run correctly in a thread.
        self.ctx = flask_app.app_context()
        # Pushes the application context to make it active.
        self.ctx.push()
        # Sets the thread as a daemon, so it will exit when the main program exits.
        self.daemon = True

    # The main method that gets called when the thread starts.
    def run(self):
        # Logs that the server is starting.
        logging.info(f"Starting Flask server on port {self.server.port}...")
        # Starts the server and makes it listen for requests indefinitely.
        self.server.serve_forever()

    # A method to gracefully shut down the server.
    def shutdown(self):
        # Logs that the server is shutting down.
        logging.info("Shutting down Flask server...")
        # Calls the server's shutdown method.
        self.server.shutdown()

# --- Download Worker Function ---
# A generic function to handle all download jobs, running in a separate thread.
def download_worker(job_id, ydl_opts, url, download_path, job_type, post_download_action=None):
    """A generic worker function to handle downloads and post-processing."""
    # Defines a nested function (a "hook") that yt-dlp will call to report progress.
    def download_hook(d):
        # Checks if the status is 'downloading'.
        if d['status'] == 'downloading':
            # Checks if the job ID is still valid.
            if job_id in jobs:
                # Updates the job's status with progress, speed, and ETA.
                jobs[job_id].update({
                    'status': 'downloading',
                    'progress': d.get('_percent_str', 'N/A'),
                    'speed': d.get('_speed_str', 'N/A'), 'eta': d.get('_eta_str', 'N/A'),
                    'message': 'Downloading...'
                })
        # Checks if the status is 'finished' (meaning post-processing, like converting to MP3, is starting).
        elif d['status'] == 'finished':
            # Logs that post-processing has begun.
            logging.info(f"[{job_id}] Finished downloading a file, starting postprocessing.")
            # Updates the job's status to 'processing'.
            if job_id in jobs:
                jobs[job_id]['status'] = 'processing'
                jobs[job_id]['message'] = "Extracting audio..."

    # A try/except block to catch any errors during the download process.
    try:
        # Initializes the job's status in the global 'jobs' dictionary.
        jobs[job_id] = {
            'status': 'starting', 'progress': '0%', 'message': 'Initializing job...'
        }
        
        # --- FFMPEG PATHING: THE BUG FIX, Part 2 ---
        # This is where the fix is applied. It calls the function to get the ffmpeg path.
        ffmpeg_dir = get_ffmpeg_directory()
        # If a path was found, it sets the 'ffmpeg_location' option for yt-dlp.
        if ffmpeg_dir:
            ydl_opts['ffmpeg_location'] = ffmpeg_dir
        
        # Tells yt-dlp to use the 'download_hook' function to report progress.
        ydl_opts['progress_hooks'] = [download_hook]

        # Creates a yt-dlp instance with the specified options.
        with YoutubeDL(ydl_opts) as ydl:
            # Starts the download. This is a blocking call.
            ydl.download([url])
        
        # After download, updates the status to 'processing' to indicate final steps are running.
        jobs[job_id]['status'] = 'processing'
        jobs[job_id]['message'] = 'Finalizing...'

        # If a post-download action (like zipping files) was provided, it runs it now.
        if post_download_action:
            # The action returns the final name of the created file (e.g., the zip file name).
            final_filename = post_download_action(job_id, download_path, ydl_opts)
            # Stores the final filename in the job's status.
            jobs[job_id]['filename'] = final_filename

        # Sets the final status of the job to 'completed'.
        jobs[job_id]['status'] = 'completed'
        jobs[job_id]['message'] = 'Job completed successfully!'
        # Logs that the job finished.
        logging.info(f"[{job_id}] Job completed successfully.")

    # Catches any exception that occurs in the 'try' block.
    except Exception as e:
        # Logs the full error with a traceback.
        logging.error(f"Error in job {job_id}: {e}", exc_info=True)
        # Updates the job's status to 'failed' and stores the error message.
        jobs[job_id]['status'] = 'failed'
        jobs[job_id]['error'] = str(e)

# --- Post-Download Actions ---
# This function runs after a single MP3 has been downloaded to determine its final filename.
def post_process_single_mp3(job_id, download_path, ydl_opts):
    # Creates a yt-dlp instance to get video information without re-downloading.
    with YoutubeDL(ydl_opts) as ydl:
        # Gets the original URL from the options.
        info_dict = ydl.extract_info(ydl_opts.get('original_url'), download=False)
        # Uses yt-dlp's internal function to determine what the filename *would* be.
        base_filename = ydl.prepare_filename(info_dict)
        # Since it's being converted to MP3, changes the extension to '.mp3'.
        final_filename = os.path.splitext(base_filename)[0] + '.mp3'
        # Returns just the filename part, not the full path.
        return os.path.basename(final_filename)

# This function runs after a playlist is downloaded to zip all the MP3 files.
def post_process_zip_playlist(job_id, download_path, ydl_opts):
    # Gets the temporary directory where the files were downloaded.
    temp_dir = os.path.dirname(ydl_opts['outtmpl']['default'])
    # Gets the title of the playlist to use for the zip file name.
    playlist_title = ydl_opts.get('playlist_title', f'playlist_{job_id}')
    # Constructs the full path for the zip file, without the '.zip' extension.
    zip_filename_base = os.path.join(download_path, playlist_title)
    # Creates the zip archive from the contents of the temporary directory.
    shutil.make_archive(zip_filename_base, 'zip', temp_dir)
    # Deletes the temporary directory and all its contents.
    shutil.rmtree(temp_dir)
    # Returns the name of the created zip file.
    return f"{playlist_title}.zip"

# This function runs after a playlist is downloaded to combine all MP3s into one file.
def post_process_combine_playlist(job_id, download_path, ydl_opts):
    # Gets the temporary directory where the files were downloaded.
    temp_dir = os.path.dirname(ydl_opts['outtmpl']['default'])
    # Gets the title of the playlist for the final combined MP3 file name.
    playlist_title = ydl_opts.get('playlist_title', f'playlist_{job_id}')
    # Constructs the full path for the final output file.
    output_filename = os.path.join(download_path, f"{playlist_title} (Combined).mp3")
    
    # Creates a sorted list of all '.mp3' files in the temporary directory.
    mp3_files = sorted([f for f in os.listdir(temp_dir) if f.endswith('.mp3')])
    # If no MP3 files are found, raises an error.
    if not mp3_files: raise Exception("No MP3 files found to combine.")

    # Creates a temporary text file that ffmpeg will use as a list of files to combine.
    filelist_path = os.path.join(temp_dir, 'filelist.txt')
    # Opens the text file for writing.
    with open(filelist_path, 'w', encoding='utf-8') as f:
        # Loops through each MP3 file.
        for mp3_file in mp3_files:
            # Creates the full path to the MP3 and escapes single quotes for ffmpeg.
            full_mp3_path = os.path.join(temp_dir, mp3_file).replace("'", "'\\''")
            # Writes the line 'file \'/path/to/file.mp3\'' to the text file.
            f.write(f"file '{full_mp3_path}'\n")

    # --- FFMPEG PATHING: THE BUG FIX, Part 3 ---
    # This is the third part of the fix, for calling ffmpeg directly.
    # Gets the directory containing the ffmpeg binaries.
    ffmpeg_dir = get_ffmpeg_directory()
    # Determines the correct executable name based on the operating system.
    ffmpeg_exe = 'ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg'
    # Constructs the full path to the ffmpeg executable. If not found, just use 'ffmpeg' and hope it's in the system PATH.
    ffmpeg_path = os.path.join(ffmpeg_dir, ffmpeg_exe) if ffmpeg_dir else 'ffmpeg'

    # Assembles the full command-line instruction for ffmpeg to combine the files.
    ffmpeg_command = [ffmpeg_path, '-f', 'concat', '-safe', '0', '-i', filelist_path, '-c', 'copy', '-y', output_filename]
    
    # Logs the command being run.
    logging.info(f"[{job_id}] Running ffmpeg command: {' '.join(ffmpeg_command)}")
    # Executes the ffmpeg command using subprocess.
    result = subprocess.run(ffmpeg_command, capture_output=True, text=True, encoding='utf-8')
    
    # Checks if the command returned a non-zero exit code, which indicates an error.
    if result.returncode != 0:
        # Logs the error output from ffmpeg.
        logging.error(f"[{job_id}] FFmpeg error: {result.stderr}")
        # Raises an exception with the error message.
        raise Exception(f"FFmpeg failed: {result.stderr}")

    # Deletes the temporary directory.
    shutil.rmtree(temp_dir)
    # Returns the name of the final combined file.
    return os.path.basename(output_filename)

# --- API Endpoints ---
# Defines the API route for starting a single MP3 download job.
@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    # Gets the JSON data sent from the frontend.
    data = request.json
    # Creates a unique ID for this job.
    job_id = str(uuid.uuid4())
    # Assembles the options for yt-dlp for a single MP3 download.
    ydl_opts = {
        'format': 'bestaudio/best', 'noplaylist': True,
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
        'outtmpl': {'default': os.path.join(data['downloadPath'], '%(title)s.%(ext)s')},
        'original_url': data['url']
    }
    # Creates and starts a new background thread to run the download worker.
    thread = Thread(target=download_worker, args=(job_id, ydl_opts, data['url'], data['downloadPath'], 'single', post_process_single_mp3))
    thread.daemon = True; thread.start()
    # Immediately returns the new job ID to the frontend.
    return jsonify({'jobId': job_id})

# Defines the API route for starting a playlist download as a zip file.
@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    # Gets the JSON data from the frontend.
    data = request.json
    # Creates a unique ID for this job.
    job_id = str(uuid.uuid4())
    # Gets just the playlist title without downloading the whole playlist.
    with YoutubeDL({'extract_flat': True, 'quiet': True}) as ydl:
        info = ydl.extract_info(data['playlistUrl'], download=False)
        playlist_title = info.get('title', f'playlist-{job_id}')
    
    # Creates a temporary directory for this specific job's downloads.
    temp_dir = os.path.join(data['downloadPath'], f"temp_{job_id}"); os.makedirs(temp_dir, exist_ok=True)
    # Assembles the yt-dlp options for downloading a playlist.
    ydl_opts = {
        'format': 'bestaudio/best', 'noplaylist': False,
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
        'outtmpl': {'default': os.path.join(temp_dir, '%(playlist_index)s - %(title)s.%(ext)s')},
        'playlist_title': playlist_title
    }
    # Creates and starts a new background thread for the download.
    thread = Thread(target=download_worker, args=(job_id, ydl_opts, data['playlistUrl'], data['downloadPath'], 'playlistZip', post_process_zip_playlist))
    thread.daemon = True; thread.start()
    # Returns the job ID to the frontend.
    return jsonify({'jobId': job_id})

# Defines the API route for starting a job to download and combine a playlist into one MP3.
@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job():
    # Gets the JSON data from the frontend.
    data = request.json
    # Creates a unique ID for this job.
    job_id = str(uuid.uuid4())
    # Gets just the playlist title.
    with YoutubeDL({'extract_flat': True, 'quiet': True}) as ydl:
        info = ydl.extract_info(data['playlistUrl'], download=False)
        playlist_title = info.get('title', f'playlist-{job_id}')

    # Creates a temporary directory for the download.
    temp_dir = os.path.join(data['downloadPath'], f"temp_{job_id}"); os.makedirs(temp_dir, exist_ok=True)
    # Assembles the yt-dlp options.
    ydl_opts = {
        'format': 'bestaudio/best', 'noplaylist': False,
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
        'outtmpl': {'default': os.path.join(temp_dir, '%(playlist_index)s - %(title)s.%(ext)s')},
        'playlist_title': playlist_title
    }
    # Creates and starts a new background thread for the download.
    thread = Thread(target=download_worker, args=(job_id, ydl_opts, data['playlistUrl'], data['downloadPath'], 'combinePlaylist', post_process_combine_playlist))
    thread.daemon = True; thread.start()
    # Returns the job ID to the frontend.
    return jsonify({'jobId': job_id})

# Defines the API route for checking the status of a job.
@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status(job_id):
    # Retrieves the job's status from the global 'jobs' dictionary.
    job = jobs.get(job_id)
    # If the job is not found, returns a 404 error.
    if not job: return jsonify({'status': 'not_found', 'message': 'Job not found.'}), 404
    # Returns the job's status as JSON.
    return jsonify(job)

# --- Main Execution ---
# This block runs only when the script is executed directly (not when imported as a module).
if __name__ == '__main__':
    # Gets the port number from the command-line arguments.
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    # Creates an instance of the server thread.
    server_thread = ServerThread(app, port)
    # Starts the server thread.
    server_thread.start()
    # A try/except block to handle a graceful shutdown.
    try:
        # This loop keeps the main program running indefinitely.
        while True: pass
    # Catches the KeyboardInterrupt signal (e.g., when pressing Ctrl+C).
    except KeyboardInterrupt:
        # Shuts down the server thread gracefully.
        server_thread.shutdown()
        # Exits the program.
        sys.exit(0)
