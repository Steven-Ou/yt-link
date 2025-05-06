import os
import subprocess
import tempfile
import shutil
import logging
from flask import Flask, request, send_file, jsonify, Response, stream_with_context
from urllib.parse import quote # For filename encoding

# Configure logging
logging.basicConfig(level=logging.INFO)

# --- Check if yt-dlp exists ---
YTDLP_PATH = shutil.which("yt-dlp")
if not YTDLP_PATH:
    logging.warning("yt-dlp command not found in PATH. Ensure it's installed and accessible.")
    # Consider adding more robust error handling or alternative paths if needed

app = Flask(__name__)

# Helper to encode filename for Content-Disposition
def sanitize_filename_header(filename):
    return quote(filename)

# --- Endpoint to process a single URL to MP3 ---
@app.route('/process-single-mp3', methods=['POST'])
def process_single_mp3():
    # --- Get data from request ---
    json_data = request.get_json()
    if not json_data:
        return jsonify({"error": "Invalid JSON request body"}), 400

    url = json_data.get('url')
    cookie_data = json_data.get('cookieData') # Get potential cookie data

    if not url:
        logging.error("Request received without URL.")
        return jsonify({"error": "No URL provided"}), 400

    if not YTDLP_PATH:
         logging.error("yt-dlp path not configured.")
         return jsonify({"error": "Server configuration error: yt-dlp not found."}), 500

    # Use a temporary directory that cleans itself up
    with tempfile.TemporaryDirectory() as tmpdir:
        logging.info(f"Created temporary directory: {tmpdir}")
        output_template = os.path.join(tmpdir, '%(title)s.%(ext)s') # Use title in filename

        # --- Prepare base yt-dlp arguments ---
        args = [
            YTDLP_PATH,
            '-x', # Extract audio
            '--audio-format', 'mp3',
            '-o', output_template,
            '--no-playlist', # Ensure only single video
            # Add other flags if needed, e.g., '--socket-timeout', '30'
        ]

        # --- Handle Cookies ---
        cookie_file_path = None
        if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
            try:
                # Create path for temp cookie file INSIDE the temp directory
                cookie_file_path = os.path.join(tmpdir, 'cookies.txt')
                with open(cookie_file_path, 'w', encoding='utf-8') as f:
                    f.write(cookie_data)
                logging.info(f"Saved received cookie data to temporary file: {cookie_file_path}")
                # Add the cookies argument to the command
                args.extend(['--cookies', cookie_file_path])
            except Exception as e:
                logging.error(f"Failed to write temporary cookie file: {e}")
                # Decide how to handle: proceed without cookies or fail?
                # Let's proceed without for now, yt-dlp might still work for public videos
                cookie_file_path = None # Ensure it's None so we don't try to use it
                args = [arg for arg in args if not arg.startswith('--cookies')] # Remove flag if writing failed

        # Add the URL as the last argument
        args.append(url)

        # --- Execute yt-dlp ---
        try:
            logging.info(f"Running yt-dlp for URL: {url}")
            logging.info(f"Command args: {' '.join(args)}")

            process = subprocess.run(
                args,
                check=True,
                timeout=300, # 5 minute timeout - adjust if needed
                capture_output=True,
                text=True,
                encoding='utf-8' # Specify encoding
            )
            logging.info(f"yt-dlp stdout: {process.stdout}")
            if process.stderr:
                 logging.warning(f"yt-dlp stderr: {process.stderr}")

            # Find the downloaded MP3 file
            files = os.listdir(tmpdir)
            # Be more specific if other temp files might exist
            mp3_file = next((f for f in files if f.lower().endswith('.mp3') and not f == 'cookies.txt'), None)

            if mp3_file:
                file_path = os.path.join(tmpdir, mp3_file)
                file_size = os.path.getsize(file_path)
                logging.info(f"Found MP3: {file_path}, Size: {file_size}")

                # --- Stream the file back ---
                def generate():
                    # (generate function remains the same as before)
                    try:
                        with open(file_path, 'rb') as f:
                            while True:
                                chunk = f.read(4096)
                                if not chunk: break
                                yield chunk
                        logging.info(f"Finished streaming {mp3_file}")
                    except Exception as e:
                         logging.error(f"Error during file streaming: {e}")

                fallback_filename = 'downloaded_audio.mp3';
                encoded_filename = sanitize_filename_header(mp3_file)
                headers = {
                     'Content-Disposition': f'attachment; filename="{fallback_filename}"; filename*=UTF-8\'\'{encoded_filename}',
                     'Content-Type': 'audio/mpeg',
                     'Content-Length': str(file_size)
                }
                return Response(stream_with_context(generate()), headers=headers)

            else:
                logging.error(f"yt-dlp ran but no MP3 file found in {tmpdir}. Files: {files}")
                # Include stderr in error if available
                stderr_snippet = process.stderr[:500] if process.stderr else "No stderr output."
                return jsonify({"error": f"yt-dlp did not produce an MP3 file. Stderr: {stderr_snippet}"}), 500

        except subprocess.CalledProcessError as e:
            logging.error(f"yt-dlp failed with exit code {e.returncode}. stderr: {e.stderr}")
            error_detail = e.stderr[:500] if e.stderr else "Unknown yt-dlp error"
            return jsonify({"error": f"yt-dlp failed: {error_detail}"}), 500
        except subprocess.TimeoutExpired:
             logging.error(f"yt-dlp timed out for URL: {url}")
             return jsonify({"error": "Processing timed out"}), 504
        except Exception as e:
            logging.error(f"An unexpected error occurred: {e}", exc_info=True)
            return jsonify({"error": f"An internal server error occurred"}), 500
        # Temporary directory 'tmpdir' and 'cookies.txt' inside it are automatically deleted here

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)

