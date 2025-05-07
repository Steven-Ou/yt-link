import os
import subprocess
import tempfile
import shutil
import logging
import zipfile
import json # Ensure json is imported
from flask import Flask, request, send_file, jsonify, Response, stream_with_context, after_this_request, send_from_directory
from urllib.parse import quote

# Configure logging
logging.basicConfig(level=logging.INFO)

# --- Check if yt-dlp exists ---
YTDLP_PATH = shutil.which("yt-dlp")
if not YTDLP_PATH:
    logging.warning("yt-dlp command not found in PATH. Ensure it's installed and accessible.")

# --- Check if ffmpeg exists ---
FFMPEG_PATH = shutil.which("ffmpeg")
if not FFMPEG_PATH:
    logging.warning("ffmpeg command not found in PATH. Combining videos will likely fail.")

app = Flask(__name__)

# Helper to encode filename for Content-Disposition
def sanitize_filename_header(filename):
    return quote(filename)

# Helper function to sort files based on playlist index prefix
def sort_files_by_playlist_index(a, b):
    regex = r'^(\d+)\.'
    import re
    match_a = re.match(regex, a)
    match_b = re.match(regex, b)
    index_a = int(match_a.group(1)) if match_a else float('inf')
    index_b = int(match_b.group(1)) if match_b else float('inf')
    return index_a - index_b

# --- Endpoint to process a single URL to MP3 ---
@app.route('/process-single-mp3', methods=['POST'])
def process_single_mp3():
    json_data = request.get_json()
    if not json_data: return jsonify({"error": "Invalid JSON request body"}), 400
    url = json_data.get('url')
    cookie_data = json_data.get('cookieData')
    if not url: return jsonify({"error": "No URL provided"}), 400
    if not YTDLP_PATH: return jsonify({"error": "Server configuration error: yt-dlp not found."}), 500

    tmpdir = None
    try:
        tmpdir = tempfile.mkdtemp()
        logging.info(f"Created temporary directory: {tmpdir}")
        output_template = os.path.join(tmpdir, '%(title)s.%(ext)s')
        args = [ YTDLP_PATH, '-x', '--audio-format', 'mp3', '-o', output_template, '--no-playlist' ]
        cookie_file_path = None
        if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
            try:
                cookie_file_path = os.path.join(tmpdir, 'cookies.txt')
                with open(cookie_file_path, 'w', encoding='utf-8') as f: f.write(cookie_data)
                logging.info(f"Saved cookie data to: {cookie_file_path}")
                args.extend(['--cookies', cookie_file_path])
            except Exception as e:
                logging.error(f"Failed to write cookie file: {e}")
                args = [arg for arg in args if not arg.startswith('--cookies')]
        args.append('--') # Add separator
        args.append(url) # Add URL

        logging.info(f"Running yt-dlp for URL: {url}")
        logging.info(f"Command args: {' '.join(args)}")
        process = subprocess.run( args, check=True, timeout=300, capture_output=True, text=True, encoding='utf-8')
        logging.info(f"yt-dlp stdout: {process.stdout}")
        if process.stderr: logging.warning(f"yt-dlp stderr: {process.stderr}")

        files = os.listdir(tmpdir)
        mp3_file = next((f for f in files if f.lower().endswith('.mp3') and not f == 'cookies.txt'), None)

        if mp3_file:
            file_path_full = os.path.join(tmpdir, mp3_file)
            logging.info(f"Found MP3: {file_path_full}")
            @after_this_request
            def cleanup(response):
                try:
                    if tmpdir and os.path.exists(tmpdir):
                        logging.info(f"Cleaning up temporary directory: {tmpdir}")
                        shutil.rmtree(tmpdir)
                except Exception as e: logging.error(f"Error during cleanup: {e}")
                return response
            logging.info(f"Sending file: {mp3_file} from directory: {tmpdir}")
            fallback_filename = 'downloaded_audio.mp3';
            encoded_filename = sanitize_filename_header(mp3_file)
            headers = { 'Content-Disposition': f'attachment; filename="{fallback_filename}"; filename*=UTF-8\'\'{encoded_filename}' }
            return send_from_directory( tmpdir, mp3_file, as_attachment=True, download_name=mp3_file ), 200, headers
        else:
            if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir)
            logging.error(f"yt-dlp ran but no MP3 file found in {tmpdir}. Files: {files}")
            stderr_snippet = process.stderr[:500] if process.stderr else "No stderr output."
            return jsonify({"error": f"yt-dlp did not produce an MP3 file. Stderr: {stderr_snippet}"}), 500
    except subprocess.CalledProcessError as e:
        if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir)
        logging.error(f"yt-dlp failed with exit code {e.returncode}. stderr: {e.stderr}")
        error_detail = e.stderr[:500] if e.stderr else "Unknown yt-dlp error"
        if "confirm you’re not a bot" in error_detail or "Use --cookies" in error_detail:
             return jsonify({"error": f"Authentication required. Please provide cookies. ({error_detail})"}), 403
        else:
             return jsonify({"error": f"yt-dlp failed: {error_detail}"}), 500
    except subprocess.TimeoutExpired:
        if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir)
        logging.error(f"yt-dlp timed out for URL: {url}")
        return jsonify({"error": "Processing timed out"}), 504
    except Exception as e:
        if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir)
        logging.error(f"An unexpected error occurred: {e}", exc_info=True)
        return jsonify({"error": f"An internal server error occurred"}), 500


# --- Endpoint to process Playlist to Zip ---
@app.route('/process-playlist-zip', methods=['POST'])
def process_playlist_zip():
    json_data = request.get_json()
    if not json_data: return jsonify({"error": "Invalid JSON request body"}), 400
    playlist_url = json_data.get('playlistUrl')
    cookie_data = json_data.get('cookieData')
    if not playlist_url: return jsonify({"error": "No playlist URL provided"}), 400
    if not YTDLP_PATH: return jsonify({"error": "Server configuration error: yt-dlp not found."}), 500

    tmpdir = None
    zip_file_path = None
    try:
        tmpdir = tempfile.mkdtemp()
        logging.info(f"Created temporary directory for playlist zip: {tmpdir}")
        output_template = os.path.join(tmpdir, '%(playlist_index)s.%(title)s.%(ext)s')
        args = [ YTDLP_PATH, '-x', '--audio-format', 'mp3', '-o', output_template ]
        cookie_file_path = None
        if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
            try:
                cookie_file_path = os.path.join(tmpdir, 'cookies.txt')
                with open(cookie_file_path, 'w', encoding='utf-8') as f: f.write(cookie_data)
                logging.info(f"Saved cookie data to: {cookie_file_path}")
                args.extend(['--cookies', cookie_file_path])
            except Exception as e:
                logging.error(f"Failed to write cookie file: {e}")
                args = [arg for arg in args if not arg.startswith('--cookies')]
        args.append('--') # Add separator
        args.append(playlist_url) # Add playlist URL

        logging.info(f"Running yt-dlp for playlist: {playlist_url}")
        logging.info(f"Command args: {' '.join(args)}")
        process = subprocess.run( args, check=True, timeout=900, capture_output=True, text=True, encoding='utf-8')
        logging.info(f"yt-dlp playlist stdout: {process.stdout}")
        if process.stderr: logging.warning(f"yt-dlp playlist stderr: {process.stderr}")

        files = os.listdir(tmpdir)
        mp3_files = [f for f in files if f.lower().endswith('.mp3') and not f == 'cookies.txt']
        if not mp3_files:
            if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir)
            stderr_snippet = process.stderr[:500] if process.stderr else "No stderr output."
            return jsonify({"error": f"yt-dlp did not produce any MP3 files. Stderr: {stderr_snippet}"}), 500

        logging.info(f"Found {len(mp3_files)} MP3 files. Zipping...")
        zip_filename = f"playlist_{os.path.basename(tmpdir)}.zip"
        zip_file_path = os.path.join(tmpdir, zip_filename)
        with zipfile.ZipFile(zip_file_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for mp3_file in mp3_files:
                mp3_file_full_path = os.path.join(tmpdir, mp3_file)
                zipf.write(mp3_file_full_path, arcname=mp3_file)
        logging.info(f"Created zip file: {zip_file_path}")

        @after_this_request
        def cleanup(response):
            try:
                if tmpdir and os.path.exists(tmpdir):
                    logging.info(f"Cleaning up playlist zip temporary directory: {tmpdir}")
                    shutil.rmtree(tmpdir)
            except Exception as e: logging.error(f"Error during playlist zip cleanup: {e}")
            return response

        logging.info(f"Sending zip file: {zip_filename} from directory: {tmpdir}")
        headers = { 'Content-Disposition': f'attachment; filename="{zip_filename}"' }
        return send_from_directory(tmpdir, zip_filename, as_attachment=True), 200, headers
    except subprocess.CalledProcessError as e:
        if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir)
        logging.error(f"yt-dlp (playlist zip) failed: {e.stderr}")
        error_detail = e.stderr[:500] if e.stderr else "Unknown yt-dlp error"
        if "confirm you’re not a bot" in error_detail or "Use --cookies" in error_detail:
             return jsonify({"error": f"Authentication required for one or more items. Please provide cookies. ({error_detail})"}), 403
        else:
            return jsonify({"error": f"yt-dlp failed: {error_detail}"}), 500
    except subprocess.TimeoutExpired:
        if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir)
        logging.error(f"yt-dlp (playlist zip) timed out for URL: {playlist_url}")
        return jsonify({"error": "Processing timed out"}), 504
    except Exception as e:
        if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir)
        logging.error(f"An unexpected error occurred (playlist zip): {e}", exc_info=True)
        return jsonify({"error": f"An internal server error occurred"}), 500


# --- Endpoint to Combine Playlist to Single Video ---
@app.route('/process-combine-video', methods=['POST'])
def process_combine_video():
    json_data = request.get_json()
    if not json_data: return jsonify({"error": "Invalid JSON request body"}), 400
    playlist_url = json_data.get('playlistUrl')
    cookie_data = json_data.get('cookieData')
    if not playlist_url: return jsonify({"error": "No playlist URL provided"}), 400
    if not YTDLP_PATH: return jsonify({"error": "Server configuration error: yt-dlp not found."}), 500
    if not FFMPEG_PATH: return jsonify({"error": "Server configuration error: ffmpeg not found."}), 500

    tmpdir = None
    final_video_path = None
    playlist_title = "combined_video" # Default

    try:
        tmpdir = tempfile.mkdtemp()
        logging.info(f"Created temporary directory for combine video: {tmpdir}")

        # --- 0. Get Playlist Title ---
        try:
            logging.info(f"Fetching playlist title for combine video: {playlist_url}")
            title_args = [ YTDLP_PATH, '--flat-playlist', '--dump-single-json' ]
            cookie_file_path_title = None
            if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
                 try:
                     cookie_file_path_title = os.path.join(tmpdir, 'cookies_title.txt')
                     with open(cookie_file_path_title, 'w', encoding='utf-8') as f: f.write(cookie_data)
                     title_args.extend(['--cookies', cookie_file_path_title])
                 except Exception as e: logging.error(f"Failed to write cookie file for title: {e}")
            title_args.extend(['--', playlist_url])

            title_process = subprocess.run(title_args, check=True, timeout=60, capture_output=True, text=True, encoding='utf-8')
            if cookie_file_path_title and os.path.exists(cookie_file_path_title): os.remove(cookie_file_path_title)

            playlist_info = json.loads(title_process.stdout)
            # More robust title checking
            if isinstance(playlist_info, dict):
                current_title = playlist_info.get('title')
                if not current_title:
                    current_title = playlist_info.get('playlist_title')

                if current_title:
                    playlist_title = current_title
                    logging.info(f"Using playlist title for combined video: {playlist_title}")
                else:
                    logging.warning(f"Could not find 'title' or 'playlist_title' in JSON. JSON keys: {list(playlist_info.keys())}. Using default.")
            else:
                 logging.warning(f"Playlist info is not a dictionary. JSON: {playlist_info}. Using default.")
        except Exception as title_error:
            logging.warning(f"Could not get playlist title: {str(title_error)}. Using default.") # Log the error string
            if 'cookie_file_path_title' in locals() and cookie_file_path_title and os.path.exists(cookie_file_path_title): os.remove(cookie_file_path_title)


        # --- 1. Download Videos ---
        logging.info(f"Downloading videos for playlist: {playlist_url}")
        video_format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4/best'
        output_template = os.path.join(tmpdir, '%(playlist_index)s.%(title)s.%(ext)s')
        ytdlp_video_args = [ YTDLP_PATH, '-f', video_format, '-o', output_template ]
        cookie_file_path_dl = None
        if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
             try:
                 cookie_file_path_dl = os.path.join(tmpdir, 'cookies_dl.txt')
                 with open(cookie_file_path_dl, 'w', encoding='utf-8') as f: f.write(cookie_data)
                 ytdlp_video_args.extend(['--cookies', cookie_file_path_dl])
             except Exception as e:
                 logging.error(f"Failed to write cookie file for download: {e}")
                 ytdlp_video_args = [arg for arg in ytdlp_video_args if not arg.startswith('--cookies')]
        ytdlp_video_args.extend(['--', playlist_url])

        logging.info(f"yt-dlp video download args: {' '.join(ytdlp_video_args)}")

        video_process = subprocess.run(ytdlp_video_args, check=True, timeout=1800, capture_output=True, text=True, encoding='utf-8')
        logging.info(f"yt-dlp video download stdout: {video_process.stdout}")
        if video_process.stderr: logging.warning(f"yt-dlp video download stderr: {video_process.stderr}")

        # --- 2. List, Sort, and Create FFmpeg List File ---
        files = os.listdir(tmpdir)
        video_files = [f for f in files if f.lower().endswith(('.mp4', '.mkv', '.webm')) and not f.startswith('cookies_')]
        if not video_files:
             if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir)
             stderr_snippet = video_process.stderr[:500] if video_process.stderr else "No stderr output."
             return jsonify({"error": f"yt-dlp did not produce any video files. Stderr: {stderr_snippet}"}), 500
        video_files.sort(key=lambda f: sort_files_by_playlist_index(f, ''))
        logging.info(f"Found and sorted video files: {video_files}")
        ffmpeg_list_path = os.path.join(tmpdir, 'mylist.txt')
        with open(ffmpeg_list_path, 'w', encoding='utf-8') as f:
            for vf in video_files:
                escaped_path = os.path.join(tmpdir, vf).replace("'", "'\\''")
                f.write(f"file '{escaped_path}'\n")
        logging.info(f"Generated FFmpeg file list: {ffmpeg_list_path}")

        # --- 3. Run FFmpeg ---
        def sanitize_fs_filename(name):
             name = name.replace('/', '_').replace('\\', '_').replace(':', '_').replace('*', '_').replace('?', '_').replace('"', '_').replace('<', '_').replace('>', '_').replace('|', '_')
             return name.strip() or 'untitled_video'
        
        final_video_filename = f"{sanitize_fs_filename(playlist_title)}.mp4"
        final_video_path = os.path.join(tmpdir, final_video_filename)
        ffmpeg_args = [ FFMPEG_PATH, '-f', 'concat', '-safe', '0', '-i', ffmpeg_list_path, '-c', 'copy', final_video_path ]
        logging.info(f"Running ffmpeg command: {' '.join(ffmpeg_args)}")
        ffmpeg_process = subprocess.run(ffmpeg_args, check=True, timeout=3600, capture_output=True, text=True, encoding='utf-8')
        logging.info(f"ffmpeg stdout: {ffmpeg_process.stdout}")
        if ffmpeg_process.stderr: logging.warning(f"ffmpeg stderr: {ffmpeg_process.stderr}")
        logging.info(f"FFmpeg finished. Combined video at: {final_video_path}")

        # --- 4. Schedule Cleanup ---
        @after_this_request
        def cleanup(response):
            try:
                if tmpdir and os.path.exists(tmpdir):
                    logging.info(f"Cleaning up combine video temporary directory: {tmpdir}")
                    shutil.rmtree(tmpdir)
            except Exception as e: logging.error(f"Error during combine video cleanup: {e}")
            return response

        # --- 5. Send Combined Video File ---
        logging.info(f"Sending combined video file: {final_video_filename} from directory: {tmpdir}")
        fallback_filename = 'combined_video.mp4';
        encoded_filename = sanitize_filename_header(final_video_filename)
        headers = { 'Content-Disposition': f'attachment; filename="{fallback_filename}"; filename*=UTF-8\'\'{encoded_filename}' }
        mime_type = 'video/mp4'
        headers['Content-Type'] = mime_type
        return send_from_directory(tmpdir, final_video_filename, as_attachment=True), 200, headers

    # --- Error Handling ---
    except subprocess.CalledProcessError as e:
        tool_name = "Tool"
        cmd_str = ' '.join(e.cmd) if isinstance(e.cmd, list) else str(e.cmd)
        if YTDLP_PATH and YTDLP_PATH in cmd_str: tool_name = "yt-dlp"
        elif FFMPEG_PATH and FFMPEG_PATH in cmd_str: tool_name = "ffmpeg"
        if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir)
        logging.error(f"{tool_name} (combine video) failed: {e.stderr}")
        error_detail = e.stderr[:500] if e.stderr else f"Unknown {tool_name} error"
        if "confirm you’re not a bot" in error_detail or "Use --cookies" in error_detail:
             return jsonify({"error": f"Authentication required for one or more items. Please provide cookies. ({error_detail})"}), 403
        else:
            return jsonify({"error": f"{tool_name} failed: {error_detail}"}), 500
    except subprocess.TimeoutExpired:
        if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir)
        logging.error(f"Processing (combine video) timed out for URL: {playlist_url}")
        return jsonify({"error": "Processing timed out"}), 504
    except Exception as e:
        if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir)
        logging.error(f"An unexpected error occurred (combine video): {e}", exc_info=True)
        return jsonify({"error": f"An internal server error occurred"}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)

