import sys
import os
import logging
from flask import Flask, request, jsonify
from yt_dlp import YoutubeDL
import threading
import uuid
import shutil

# --- Basic Setup ---
app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Job Management ---
jobs = {}

# --- Core Logic: Finding Packaged Binaries ---
# This is the key function to locate ffmpeg/ffprobe when the app is packaged.
def get_resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    # PyInstaller creates a temp folder and stores path in _MEIPASS
    # The Python executable will be in 'backend', and the binaries in 'bin'.
    # So we need to go up one level from the script's location.
    base_path = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    # When packaged, the python script is inside a 'backend' folder in resources.
    # The ffmpeg binary is in a 'bin' folder at the same level.
    # So the path from our script is '../bin/<binary>'
    if getattr(sys, 'frozen', False):
         # Running as a PyInstaller bundle
        return os.path.join(os.path.dirname(base_path), "bin", relative_path)
    else:
        # Running as a normal script
        # We assume ffmpeg is in the system PATH for development.
        found_path = shutil.which(relative_path.split('.')[0]) # shutil.which needs the command name, e.g., 'ffmpeg'
        if found_path:
            return found_path
        # Fallback for dev if not in PATH but is in the project's bin folder
        dev_path = os.path.join(os.path.dirname(base_path), '..', 'bin', relative_path)
        if os.path.exists(dev_path):
            return dev_path
        return None # Let yt-dlp try to find it.

# --- Get Paths for Binaries ---
FFMPEG_PATH = get_resource_path('ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg')
FFPROBE_PATH = get_resource_path('ffprobe.exe' if sys.platform == 'win32' else 'ffprobe')

logging.info(f"FFMPEG Path: {FFMPEG_PATH}")
logging.info(f"FFPROBE Path: {FFPROBE_PATH}")


# --- Worker Functions for YouTube Downloads ---

def download_single_mp3(job_id, url, download_path, cookies_file_path=None):
    jobs[job_id] = {'status': 'processing', 'progress': 0, 'message': 'Starting download...'}
    try:
        def progress_hook(d):
            if d['status'] == 'downloading':
                percentage = d['_percent_str']
                jobs[job_id]['progress'] = float(percentage.strip('%'))
                jobs[job_id]['message'] = f"Downloading: {percentage}"
            elif d['status'] == 'finished':
                jobs[job_id]['message'] = 'Download finished, converting...'

        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(download_path, '%(title)s.%(ext)s'),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'progress_hooks': [progress_hook],
            'ffmpeg_location': FFMPEG_PATH, # IMPORTANT: Tell yt-dlp where ffmpeg is
            'cookiefile': cookies_file_path,
            'nocheckcertificate': True,
        }
        
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        jobs[job_id]['status'] = 'completed'
        jobs[job_id]['progress'] = 100
        jobs[job_id]['message'] = 'Successfully downloaded and converted to MP3.'

    except Exception as e:
        logging.error(f"Error in job {job_id}: {e}")
        jobs[job_id] = {'status': 'error', 'message': str(e)}

def download_playlist_zip(job_id, url, download_path, cookies_file_path=None):
    jobs[job_id] = {'status': 'processing', 'progress': 0, 'message': 'Starting playlist download...'}
    try:
        playlist_dir = os.path.join(download_path, 'playlist_temp_' + job_id)
        os.makedirs(playlist_dir, exist_ok=True)

        def progress_hook(d):
            if d['status'] == 'finished':
                total_videos = d['playlist_index']
                jobs[job_id]['message'] = f'Finished downloading video {d["playlist_index"]}/{d.get("playlist_count", "N/A")}.'
            
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(playlist_dir, '%(playlist_index)s - %(title)s.%(ext)s'),
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3'}],
            'progress_hooks': [progress_hook],
            'ffmpeg_location': FFMPEG_PATH, # IMPORTANT
            'cookiefile': cookies_file_path,
            'nocheckcertificate': True,
        }

        with YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=False)
            playlist_title = info_dict.get('title', 'playlist')
            ydl.download([url])

        jobs[job_id]['message'] = 'Zipping files...'
        zip_path = os.path.join(download_path, f'{playlist_title}.zip')
        shutil.make_archive(zip_path.replace('.zip', ''), 'zip', playlist_dir)
        shutil.rmtree(playlist_dir)

        jobs[job_id] = {'status': 'completed', 'progress': 100, 'message': f'Playlist downloaded and zipped to {zip_path}.'}
    except Exception as e:
        logging.error(f"Error in job {job_id}: {e}")
        jobs[job_id] = {'status': 'error', 'message': str(e)}

def combine_playlist_mp3(job_id, url, download_path, cookies_file_path=None):
    jobs[job_id] = {'status': 'processing', 'progress': 0, 'message': 'Starting combined playlist download...'}
    try:
        temp_dir = os.path.join(download_path, 'temp_combine_' + job_id)
        os.makedirs(temp_dir, exist_ok=True)

        ydl_opts_initial = {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(temp_dir, '%(playlist_index)s.%(ext)s'),
            'ffmpeg_location': FFMPEG_PATH, # IMPORTANT
            'cookiefile': cookies_file_path,
            'nocheckcertificate': True,
        }

        with YoutubeDL(ydl_opts_initial) as ydl:
            info_dict = ydl.extract_info(url, download=True)
            playlist_title = info_dict.get('title', 'combined_playlist')
            files_to_merge = [os.path.join(temp_dir, ydl.prepare_filename(entry)) for entry in info_dict['entries'] if entry]
        
        jobs[job_id]['message'] = 'All videos downloaded, now merging...'
        
        output_file = os.path.join(download_path, f'{playlist_title}.mp3')
        file_list_path = os.path.join(temp_dir, 'mergelist.txt')

        with open(file_list_path, 'w', encoding='utf-8') as f:
            for fn in files_to_merge:
                f.write(f"file '{fn}'\n")

        ffmpeg_command = [
            FFMPEG_PATH,
            '-f', 'concat',
            '-safe', '0',
            '-i', file_list_path,
            '-c', 'copy',
            output_file
        ]
        
        import subprocess
        process = subprocess.run(ffmpeg_command, check=True, capture_output=True, text=True)
        
        shutil.rmtree(temp_dir)
        jobs[job_id] = {'status': 'completed', 'progress': 100, 'message': f'Playlist combined into {output_file}.'}

    except Exception as e:
        logging.error(f"Error in job {job_id}: {e}")
        jobs[job_id] = {'status': 'error', 'message': str(e)}


# --- Flask API Endpoints ---

def start_job(target_function, *args):
    job_id = str(uuid.uuid4())
    thread = threading.Thread(target=target_function, args=(job_id, *args))
    thread.start()
    return jsonify({'job_id': job_id})

@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job_route():
    data = request.json
    return start_job(download_single_mp3, data['url'], data['downloadPath'], data.get('cookiesPath'))

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job_route():
    data = request.json
    return start_job(download_playlist_zip, data['url'], data['downloadPath'], data.get('cookiesPath'))

@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job_route():
    data = request.json
    return start_job(combine_playlist_mp3, data['url'], data['downloadPath'], data.get('cookiesPath'))

@app.route('/job-status/<job_id>', methods=['GET'])
def job_status_route(job_id):
    job = jobs.get(job_id)
    if job:
        return jsonify(job)
    return jsonify({'status': 'not_found'}), 404

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    app.run(port=port)