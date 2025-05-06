import os
import subprocess
import tempfile
import shutil
import logging
# Import after_this_request from Flask
from flask import Flask, request, send_from_directory, jsonify, after_this_request
from urllib.parse import quote

# Configure logging
logging.basicConfig(level=logging.INFO)

# --- Check if yt-dlp exists ---
YTDLP_PATH = shutil.which("yt-dlp")
if not YTDLP_PATH:
    logging.warning("yt-dlp command not found in PATH. Ensure it's installed and accessible.")

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
    cookie_data = json_data.get('cookieData')
    if not url:
        logging.error("Request received without URL.")
        return jsonify({"error": "No URL provided"}), 400
    if not YTDLP_PATH:
         logging.error("yt-dlp path not configured.")
         return jsonify({"error": "Server configuration error: yt-dlp not found."}), 500

    # --- Manual Temporary Directory Creation ---
    tmpdir = None # Initialize outside try
    try:
        # Create a temporary directory manually
        tmpdir = tempfile.mkdtemp()
        logging.info(f"Created temporary directory: {tmpdir}")
        output_template = os.path.join(tmpdir, '%(title)s.%(ext)s')

        # --- Prepare base yt-dlp arguments ---
        args = [ YTDLP_PATH, '-x', '--audio-format', 'mp3', '-o', output_template, '--no-playlist' ]

        # --- Handle Cookies ---
        cookie_file_path = None
        if cookie_data and isinstance(cookie_data, str) and cookie_data.strip():
            try:
                cookie_file_path = os.path.join(tmpdir, 'cookies.txt')
                with open(cookie_file_path, 'w', encoding='utf-8') as f: f.write(cookie_data)
                logging.info(f"Saved cookie data to: {cookie_file_path}")
                args.extend(['--cookies', cookie_file_path])
            except Exception as e:
                logging.error(f"Failed to write cookie file: {e}")
                # Proceed without cookies if writing fails

        # Add URL last
        args.append(url)

        # --- Execute yt-dlp ---
        logging.info(f"Running yt-dlp for URL: {url}")
        logging.info(f"Command args: {' '.join(args)}")
        process = subprocess.run(
            args, check=True, timeout=300, capture_output=True, text=True, encoding='utf-8'
        )
        logging.info(f"yt-dlp stdout: {process.stdout}")
        if process.stderr: logging.warning(f"yt-dlp stderr: {process.stderr}")

        # --- Find the downloaded MP3 file ---
        files = os.listdir(tmpdir)
        mp3_file = next((f for f in files if f.lower().endswith('.mp3') and not f == 'cookies.txt'), None)

        if mp3_file:
            file_path_full = os.path.join(tmpdir, mp3_file)
            logging.info(f"Found MP3: {file_path_full}")

            # --- Schedule Cleanup ---
            # This function will run AFTER the response is sent
            @after_this_request
            def cleanup(response):
                try:
                    if tmpdir and os.path.exists(tmpdir):
                        logging.info(f"Cleaning up temporary directory: {tmpdir}")
                        shutil.rmtree(tmpdir) # Recursively delete the directory
                except Exception as e:
                    logging.error(f"Error during cleanup: {e}")
                return response # Must return the response

            # --- Send the file using send_from_directory ---
            # This is generally safer and handles streaming/headers better
            logging.info(f"Sending file: {mp3_file} from directory: {tmpdir}")
            # Encode filename for header
            fallback_filename = 'downloaded_audio.mp3';
            encoded_filename = sanitize_filename_header(mp3_file) # Use helper
            # Set Content-Disposition manually for non-ASCII names
            headers = {
                 'Content-Disposition': f'attachment; filename="{fallback_filename}"; filename*=UTF-8\'\'{encoded_filename}'
                 # send_from_directory sets Content-Type and Length
            }
            return send_from_directory(
                tmpdir, # The directory containing the file
                mp3_file, # The filename itself
                as_attachment=True, # Treat as download
                download_name=mp3_file # Suggest original name (browser might use header)
            ), 200, headers # Return tuple with status and headers

        else:
            # If no MP3 found, cleanup directory now before returning error
            if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir)
            logging.error(f"yt-dlp ran but no MP3 file found in {tmpdir}. Files: {files}")
            stderr_snippet = process.stderr[:500] if process.stderr else "No stderr output."
            return jsonify({"error": f"yt-dlp did not produce an MP3 file. Stderr: {stderr_snippet}"}), 500

    # --- Error Handling ---
    except subprocess.CalledProcessError as e:
        if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir) # Cleanup on error
        logging.error(f"yt-dlp failed with exit code {e.returncode}. stderr: {e.stderr}")
        error_detail = e.stderr[:500] if e.stderr else "Unknown yt-dlp error"
        return jsonify({"error": f"yt-dlp failed: {error_detail}"}), 500
    except subprocess.TimeoutExpired:
        if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir) # Cleanup on error
        logging.error(f"yt-dlp timed out for URL: {url}")
        return jsonify({"error": "Processing timed out"}), 504
    except Exception as e:
        if tmpdir and os.path.exists(tmpdir): shutil.rmtree(tmpdir) # Cleanup on error
        logging.error(f"An unexpected error occurred: {e}", exc_info=True)
        return jsonify({"error": f"An internal server error occurred"}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
