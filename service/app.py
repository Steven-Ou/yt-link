import os
import shutil
import threading
import time
import uuid
import zipfile
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import yt_dlp
import platform
import subprocess

# --- Flask App Initialization ---
app = Flask(__name__)
CORS(app)

# In-memory dictionary to store job status and results
jobs = {}

# --- FFmpeg Path Helper ---
def get_ffmpeg_path():
    """
    Determines the correct path for the ffmpeg executable based on the OS.
    This helper function is crucial for yt-dlp's post-processing to work correctly.
    """
    if platform.system() == "Windows":
        # The path should point to the executable itself
        return os.path.join(os.getcwd(), "service", "ffmpeg", "bin", "ffmpeg.exe")
    else:
        # For Mac/Linux, we assume ffmpeg might be in the PATH,
        # but we provide a bundled path as a fallback.
        local_ffmpeg_path = os.path.join(os.getcwd(), "service", "ffmpeg", "bin", "ffmpeg")
        if os.path.exists(local_ffmpeg_path):
            return local_ffmpeg_path
        # If not found locally, rely on it being in the system's PATH
        return "ffmpeg"

# --- Core Download Logic ---
def download_thread(url, ydl_opts, job_id, download_type):
    """
    This function runs in a separate thread to handle the download process
    without blocking the main server. It now includes robust cleanup.
    """
    temp_dir = os.path.join("temp", str(job_id))
    os.makedirs(temp_dir, exist_ok=True)
    
    jobs[job_id]['temp_dir'] = temp_dir
    ydl_opts['outtmpl'] = os.path.join(temp_dir, ydl_opts['outtmpl'])

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=False)
            playlist_title = info_dict.get('title', 'playlist')
            jobs[job_id]['playlist_title'] = playlist_title
            
            ydl.download([url])

        post_download_processing(job_id, temp_dir, download_type, playlist_title)

    except Exception as e:
        print(f"Error in download_thread for job {job_id}: {e}")
        jobs[job_id]['status'] = 'failed'
        jobs[job_id]['error'] = str(e)
    finally:
        if jobs.get(job_id, {}).get('status') != 'completed':
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)


def post_download_processing(job_id, temp_dir, download_type, playlist_title="download"):
    """
    Handles file operations after the download is complete, such as zipping
    or combining files.
    """
    try:
        if download_type == "single_mp3":
            files = os.listdir(temp_dir)
            mp3_files = [f for f in files if f.endswith('.mp3')]
            if mp3_files:
                file_path = os.path.join(temp_dir, mp3_files[0])
                jobs[job_id]['file_path'] = file_path
                jobs[job_id]['file_name'] = os.path.basename(file_path)
                jobs[job_id]['status'] = 'completed'
            else:
                raise FileNotFoundError("MP3 conversion failed. The MP3 file was not created.")

        elif download_type == "playlist_zip":
            zip_filename = f"{playlist_title}.zip"
            zip_path = os.path.join("temp", f"{job_id}.zip")

            mp3_files_found = False
            with zipfile.ZipFile(zip_path, 'w') as zipf:
                for file in os.listdir(temp_dir):
                    if file.endswith('.mp3'):
                        file_path = os.path.join(temp_dir, file)
                        zipf.write(file_path, arcname=file)
                        mp3_files_found = True
            
            if mp3_files_found:
                jobs[job_id]['file_path'] = zip_path
                jobs[job_id]['file_name'] = zip_filename
                jobs[job_id]['status'] = 'completed'
                shutil.rmtree(temp_dir, ignore_errors=True)
            else:
                raise FileNotFoundError("No MP3 files were created for the playlist.")
        
        elif download_type == "combine_playlist_mp3":
            mp3_files = sorted([f for f in os.listdir(temp_dir) if f.endswith('.mp3')])

            if not mp3_files:
                raise FileNotFoundError("No MP3 files were downloaded to combine.")

            list_file_path = os.path.join(temp_dir, 'filelist.txt')
            with open(list_file_path, 'w', encoding='utf-8') as f:
                for file in mp3_files:
                    full_path = os.path.abspath(os.path.join(temp_dir, file))
                    f.write(f"file '{full_path}'\n")

            output_filename = f"{playlist_title}.mp3"
            output_filepath = os.path.join("temp", output_filename)

            command = [
                get_ffmpeg_path(), '-f', 'concat', '-safe', '0', 
                '-i', list_file_path, '-c', 'copy', '-y', output_filepath
            ]

            subprocess.run(command, check=True, capture_output=True, text=True)
            
            jobs[job_id]['file_path'] = output_filepath
            jobs[job_id]['file_name'] = output_filename
            jobs[job_id]['status'] = 'completed'
            shutil.rmtree(temp_dir, ignore_errors=True)

    except Exception as e:
        print(f"Error in post_download_processing for job {job_id}: {e}")
        jobs[job_id]['status'] = 'failed'
        jobs[job_id]['error'] = str(e)


# --- Job Progress Hook ---
def progress_hook(d):
    job_id = d['info_dict'].get('job_id')
    if job_id and job_id in jobs:
        if d['status'] == 'downloading':
            jobs[job_id]['status'] = 'downloading'
            jobs[job_id]['progress'] = d.get('_percent_str', '0%')
            jobs[job_id]['eta'] = d.get('_eta_str', 'N/A')
            jobs[job_id]['speed'] = d.get('_speed_str', 'N/A')
        elif d['status'] == 'finished':
            jobs[job_id]['status'] = 'processing'

def create_job(url):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {'status': 'starting', 'url': url, 'progress': '0%'}
    return job_id

# --- API Endpoints ---
def start_job_runner(job_type):
    """A helper to reduce code duplication in the start job routes."""
    url = request.json['url']
    job_id = create_job(url)

    # Base options for all jobs
    ydl_opts = {
        'format': 'bestaudio/best',
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
        'ffmpeg_location': get_ffmpeg_path(),
        'progress_hooks': [lambda d: progress_hook(d)],
        'verbose': True,
        'info_dict': {'job_id': job_id}
    }

    # Job-specific options
    if job_type in ["playlist_zip", "combine_playlist_mp3"]:
        ydl_opts['outtmpl'] = '%(playlist_index)s - %(title)s.%(ext)s'
        ydl_opts['ignoreerrors'] = True
    else: # single_mp3
        ydl_opts['outtmpl'] = '%(title)s.%(ext)s'
        ydl_opts['noplaylist'] = True


    thread = threading.Thread(target=download_thread, args=(url, ydl_opts, job_id, job_type))
    thread.start()
    # FIX: Return 'jobId' in camelCase to match the frontend JavaScript
    return jsonify({'jobId': job_id})

@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    return start_job_runner('single_mp3')

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    return start_job_runner('playlist_zip')

@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job():
    return start_job_runner('combine_playlist_mp3')

@app.route('/job-status', methods=['GET'])
def get_job_status():
    # FIX: Get 'jobId' from query arguments to match frontend
    job_id = request.args.get('jobId')
    if not job_id:
        return jsonify({'status': 'not_found', 'error': 'jobId parameter is missing'}), 400
    
    job = jobs.get(job_id)
    if not job:
        return jsonify({'status': 'not_found'}), 404
    return jsonify(job)

@app.route('/download/<job_id>', methods=['GET'])
def download_file(job_id):
    job = jobs.get(job_id)
    if not job or job['status'] != 'completed':
        return jsonify({'error': 'File not ready or job failed'}), 404

    file_path = job.get('file_path')
    file_name = job.get('file_name')
    if not file_path or not os.path.exists(file_path):
        return jsonify({'error': 'File not found'}), 404

    def file_sender():
        try:
            with open(file_path, 'rb') as f:
                yield from f
        finally:
            os.remove(file_path)
            jobs.pop(job_id, None)

    return Response(file_sender(),
                    mimetype='application/octet-stream',
                    headers={'Content-Disposition': f'attachment;filename="{file_name}"'})


if __name__ == '__main__':
    # --- STARTUP DIAGNOSTICS ---
    try:
        if not os.path.exists('temp'):
            os.makedirs('temp')
        print("--- Flask app starting on http://127.0.0.1:5001 ---")
        print("--- Quit the server with CTRL-C ---")
        # Running on port 5001 as expected by the Next.js API routes
        app.run(debug=True, port=5001)
    except Exception as e:
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print("!!!    AN ERROR OCCURRED ON STARTUP, CANNOT RUN    !!!")
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print(f"ERROR: {e}")
        input("Press ENTER to exit...")
