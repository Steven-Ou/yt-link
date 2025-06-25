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
    # Each job gets its own temporary directory for downloads.
    temp_dir = os.path.join("temp", str(job_id))
    os.makedirs(temp_dir, exist_ok=True)
    
    # Associate the temp directory with the job for potential cleanup
    jobs[job_id]['temp_dir'] = temp_dir
    ydl_opts['outtmpl'] = os.path.join(temp_dir, ydl_opts['outtmpl'])

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Get video/playlist info before downloading
            info_dict = ydl.extract_info(url, download=False)
            playlist_title = info_dict.get('title', 'playlist')
            jobs[job_id]['playlist_title'] = playlist_title
            
            # Start the actual download
            ydl.download([url])

        # Post-download processing is now handled by a dedicated function
        post_download_processing(job_id, temp_dir, download_type, playlist_title)

    except Exception as e:
        # If any error occurs, mark the job as failed and log the error.
        print(f"Error in download_thread for job {job_id}: {e}")
        jobs[job_id]['status'] = 'failed'
        jobs[job_id]['error'] = str(e)
    finally:
        # Centralized cleanup: If the job is not completed successfully,
        # remove its temporary directory.
        if jobs.get(job_id, {}).get('status') != 'completed':
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)


def post_download_processing(job_id, temp_dir, download_type, playlist_title="download"):
    """
    Handles file operations after the download is complete, such as zipping
    or combining files. This function now contains critical checks to ensure
    only correct files are processed.
    """
    try:
        if download_type == "single_mp3":
            # --- FIX: Verify MP3 file exists ---
            # Search for the converted .mp3 file. If it's not there, the
            # conversion failed.
            files = os.listdir(temp_dir)
            mp3_files = [f for f in files if f.endswith('.mp3')]
            if mp3_files:
                file_path = os.path.join(temp_dir, mp3_files[0])
                jobs[job_id]['file_path'] = file_path
                jobs[job_id]['file_name'] = os.path.basename(file_path)
                jobs[job_id]['status'] = 'completed'
            else:
                # If no MP3 is found, fail the job with a clear error.
                # Do not send the unconverted .webm or .m4a file.
                raise FileNotFoundError("MP3 conversion failed. The MP3 file was not created.")

        elif download_type == "playlist_zip":
            # --- FIX: Only zip .mp3 files ---
            # Create a zip file containing only the successfully converted .mp3 files.
            zip_filename = f"{playlist_title}.zip"
            # Place the final zip file outside the job's temp_dir to avoid cleanup issues.
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
                # Clean up the original mp3s now that they are zipped
                shutil.rmtree(temp_dir, ignore_errors=True)
            else:
                raise FileNotFoundError("No MP3 files were created for the playlist.")
        
        elif download_type == "combine_playlist_mp3":
            # --- REWRITE: Efficiently combine MP3s ---
            # This logic is completely new. It concatenates the downloaded MP3s
            # instead of re-encoding from video files.
            mp3_files = sorted(
                [f for f in os.listdir(temp_dir) if f.endswith('.mp3')],
                key=lambda x: int(x.split(' ')[0]) if x.split(' ')[0].isdigit() else 0
            )

            if not mp3_files:
                raise FileNotFoundError("No MP3 files were downloaded to combine.")

            # Create the file list for ffmpeg, using absolute paths
            list_file_path = os.path.join(temp_dir, 'filelist.txt')
            with open(list_file_path, 'w', encoding='utf-8') as f:
                for file in mp3_files:
                    # Use absolute paths to prevent "No such file or directory"
                    full_path = os.path.abspath(os.path.join(temp_dir, file))
                    # FFMPEG requires escaping special characters in file paths
                    f.write(f"file '{full_path}'\n")

            output_filename = f"{playlist_title}.mp3"
            # Place the final combined file outside the job's temp_dir.
            output_filepath = os.path.join("temp", output_filename)

            # FFMPEG command for lossless concatenation of MP3s
            command = [
                get_ffmpeg_path(),
                '-f', 'concat',
                '-safe', '0',
                '-i', list_file_path,
                '-c', 'copy', # Copy codec, no re-encoding, much faster!
                '-y', # Overwrite output file if it exists
                output_filepath
            ]

            process = subprocess.run(command, check=True, capture_output=True, text=True)
            print("FFMPEG Concat Output:", process.stdout)
            
            jobs[job_id]['file_path'] = output_filepath
            jobs[job_id]['file_name'] = output_filename
            jobs[job_id]['status'] = 'completed'
            # Clean up the original mp3s now that they are combined
            shutil.rmtree(temp_dir, ignore_errors=True)

    except Exception as e:
        print(f"Error in post_download_processing for job {job_id}: {e}")
        jobs[job_id]['status'] = 'failed'
        jobs[job_id]['error'] = str(e)


# --- Job Progress Hook ---
def progress_hook(d):
    """
    This hook from yt-dlp provides real-time progress updates, which are
    stored in the job's state.
    """
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
    """
    Initializes a new job entry in the `jobs` dictionary.
    """
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        'status': 'starting',
        'url': url,
        'progress': '0%',
        'eta': 'N/A',
        'speed': 'N/A',
        'start_time': time.time()
    }
    return job_id

# --- API Endpoints ---

@app.route('/start-single-mp3-job', methods=['POST'])
def start_single_mp3_job():
    url = request.json['url']
    job_id = create_job(url)

    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': '%(title)s.%(ext)s',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'ffmpeg_location': get_ffmpeg_path(),
        'progress_hooks': [lambda d: progress_hook(d)],
        'verbose': True,
        'info_dict': {'job_id': job_id}
    }
    
    thread = threading.Thread(target=download_thread, args=(url, ydl_opts, job_id, "single_mp3"))
    thread.start()
    return jsonify({'job_id': job_id})

@app.route('/start-playlist-zip-job', methods=['POST'])
def start_playlist_zip_job():
    url = request.json['url']
    job_id = create_job(url)
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': '%(playlist_index)s - %(title)s.%(ext)s',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'ffmpeg_location': get_ffmpeg_path(),
        'progress_hooks': [lambda d: progress_hook(d)],
        'verbose': True,
        'info_dict': {'job_id': job_id},
        'ignoreerrors': True, # Continue downloading playlist even if one video fails
    }
    
    thread = threading.Thread(target=download_thread, args=(url, ydl_opts, job_id, "playlist_zip"))
    thread.start()
    return jsonify({'job_id': job_id})

@app.route('/start-combine-playlist-mp3-job', methods=['POST'])
def start_combine_playlist_mp3_job():
    url = request.json['url']
    job_id = create_job(url)

    # This now uses the same options as the zip job, downloading only audio
    # The combination happens in post-processing.
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': '%(playlist_index)s - %(title)s.%(ext)s',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'ffmpeg_location': get_ffmpeg_path(),
        'progress_hooks': [lambda d: progress_hook(d)],
        'verbose': True,
        'info_dict': {'job_id': job_id},
        'ignoreerrors': True,
    }
    
    thread = threading.Thread(target=download_thread, args=(url, ydl_opts, job_id, "combine_playlist_mp3"))
    thread.start()
    return jsonify({'job_id': job_id})

@app.route('/job-status/<job_id>', methods=['GET'])
def get_job_status(job_id):
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
            # Clean up the final file and the job entry after sending
            os.remove(file_path)
            jobs.pop(job_id, None)

    return Response(file_sender(),
                    mimetype='application/octet-stream',
                    headers={'Content-Disposition': f'attachment;filename="{file_name}"'})


if __name__ == '__main__':
    # Create temp directory if it doesn't exist
    if not os.path.exists('temp'):
        os.makedirs('temp')
    app.run(debug=True, port=5001)
