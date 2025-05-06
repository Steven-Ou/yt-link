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
# Try to find yt-dlp in PATH or specify a direct path if needed
YTDLP_PATH = shutil.which("yt-dlp") # Tries to find yt-dlp in the system PATH
if not YTDLP_PATH:
    # If not in PATH, you might need to point to a specific location
    # Example: YTDLP_PATH = "/path/to/your/yt-dlp"
    # For many hosting platforms, installing yt-dlp via pip might add it to PATH.
    logging.warning("yt-dlp command not found in PATH. Ensure it's installed and accessible.")
    # You could potentially stop the app here or rely on it being found later
    # For now, we'll proceed and let the subprocess call fail if it's truly missing.

app = Flask(__name__)

# Helper to encode filename for Content-Disposition
def sanitize_filename_header(filename):
    # Basic sanitization first (optional, yt-dlp usually does this)
    # filename = filename.replace('/', '_').replace('\\', '_')
    # Use urllib.parse.quote for RFC 5987 encoding
    return quote(filename)

# --- Endpoint to process a single URL to MP3 ---
@app.route('/process-single-mp3', methods=['POST'])
def process_single_mp3():
    url = request.json.get('url')
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
        args = [
            YTDLP_PATH, # Use the found path
            '-x', # Extract audio
            '--audio-format', 'mp3',
            '-o', output_template,
            '--no-playlist', # Ensure only single video is processed
            url
        ]

        try:
            logging.info(f"Running yt-dlp for URL: {url}")
            logging.info(f"Command args: {' '.join(args)}") # Log command for debugging

            # Run yt-dlp with a timeout (e.g., 5 minutes)
            # Capture output to check for errors
            process = subprocess.run(
                args,
                check=True,         # Raise error if exit code != 0
                timeout=300,        # 5 minute timeout
                capture_output=True,# Capture stdout/stderr
                text=True           # Decode output as text
            )
            logging.info(f"yt-dlp stdout: {process.stdout}")
            if process.stderr:
                 logging.warning(f"yt-dlp stderr: {process.stderr}") # Log stderr as warning

            # Find the downloaded MP3 file
            files = os.listdir(tmpdir)
            mp3_file = next((f for f in files if f.lower().endswith('.mp3')), None)

            if mp3_file:
                file_path = os.path.join(tmpdir, mp3_file)
                file_size = os.path.getsize(file_path)
                logging.info(f"Found MP3: {file_path}, Size: {file_size}")

                # --- Stream the file back ---
                def generate():
                    try:
                        with open(file_path, 'rb') as f:
                            while True:
                                chunk = f.read(4096) # Read in chunks
                                if not chunk:
                                    break
                                yield chunk
                        logging.info(f"Finished streaming {mp3_file}")
                    except Exception as e:
                         logging.error(f"Error during file streaming: {e}")
                         # This error won't reach the client directly usually,
                         # but good to log on the server.

                # Encode filename for header
                fallback_filename = 'downloaded_audio.mp3';
                encoded_filename = sanitize_filename_header(mp3_file) # Use helper

                headers = {
                     'Content-Disposition': f'attachment; filename="{fallback_filename}"; filename*=UTF-8\'\'{encoded_filename}',
                     'Content-Type': 'audio/mpeg',
                     'Content-Length': str(file_size)
                }
                # Use stream_with_context for efficient streaming
                return Response(stream_with_context(generate()), headers=headers)

            else:
                logging.error(f"yt-dlp ran but no MP3 file found in {tmpdir}. Files: {files}")
                return jsonify({"error": "yt-dlp did not produce an MP3 file."}), 500

        except subprocess.CalledProcessError as e:
            logging.error(f"yt-dlp failed with exit code {e.returncode}. stderr: {e.stderr}")
            # Return beginning of stderr, ensure it's JSON serializable
            error_detail = e.stderr[:500] if e.stderr else "Unknown yt-dlp error"
            return jsonify({"error": f"yt-dlp failed: {error_detail}"}), 500
        except subprocess.TimeoutExpired:
             logging.error(f"yt-dlp timed out for URL: {url}")
             return jsonify({"error": "Processing timed out"}), 504 # Gateway timeout
        except Exception as e:
            logging.error(f"An unexpected error occurred: {e}", exc_info=True) # Log traceback
            return jsonify({"error": f"An internal server error occurred"}), 500
        # Note: TemporaryDirectory cleans itself up automatically here

if __name__ == '__main__':
    # Get port from environment variable or default to 8080
    port = int(os.environ.get('PORT', 8080))
    # Run on 0.0.0.0 to be accessible externally (important for deployment)
    app.run(host='0.0.0.0', port=port)
