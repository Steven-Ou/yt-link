import os
import shutil
import sys
import traceback
import threading
import uuid
import zipfile
import tempfile
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import yt_dlp
import platform
import subprocess
from urllib.parse import quote
import codecs

# --- START: UTF-8 Encoding Fix for Packaged App ---
# Reconfigure stdout and stderr to use UTF-8 encoding. This is crucial for the
# packaged Windows app to handle filenames with special characters without crashing.
if sys.stdout.encoding != "utf-8":
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "strict")
if sys.stderr.encoding != "utf-8":
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "strict")
# --- END: UTF-8 Encoding Fix for Packaged App ---


def sanitize_filename(filename):
    """
    Removes characters that are invalid in Windows filenames, preserving unicode characters.
    """
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        filename = filename.replace(char, "_")
    # Also remove trailing dots and spaces which can be problematic on Windows
    return filename.strip().rstrip(".")


def get_binary_path(binary_name):
    """
    Finds the absolute path to a bundled binary. This is the most reliable method for packaged apps.
    It correctly handles the different directory structures on macOS and Windows/Linux.
    """
    # If not packaged (dev mode) and on Windows, look inside the project's bin folder.
    if not getattr(sys, "frozen", False) and platform.system() == "Windows":
        # Assuming this script is in 'service/app.py', we go up two levels to the project root.
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        dev_binary_path = os.path.join(project_root, "bin", f"{binary_name}.exe")
        if os.path.exists(dev_binary_path):
            print(
                f"--- DEV MODE (Windows): Using '{binary_name}' from project bin at '{dev_binary_path}' ---",
                flush=True,
            )
            return dev_binary_path

    # If in a packaged app (.pyinstaller)
    if getattr(sys, "frozen", False):
        try:
            base_path = os.path.dirname(sys.executable)

            if platform.system() == "Darwin":
                # Packaged macOS app structure
                binary_path = os.path.abspath(
                    os.path.join(base_path, "..", "Resources", "bin", binary_name)
                )
            else:
                # Packaged Windows/Linux app structure
                binary_path = os.path.join(base_path, "bin", binary_name)
                if platform.system() == "Windows":
                    binary_path += ".exe"

            if os.path.exists(binary_path):
                print(
                    f"--- BINARY FOUND: Located '{binary_name}' at '{binary_path}' ---",
                    flush=True,
                )
                return binary_path
            else:
                # Fallback for slightly different packaging structures
                resources_path = os.path.abspath(os.path.join(base_path, ".."))
                fallback_path = os.path.join(resources_path, "bin", binary_name)
                if platform.system() == "Windows":
                    fallback_path += ".exe"

                if os.path.exists(fallback_path):
                    print(
                        f"--- BINARY FOUND (Fallback): Located '{binary_name}' at '{fallback_path}' ---",
                        flush=True,
                    )
                    return fallback_path

                print(
                    f"--- BINARY NOT FOUND: Could not find '{binary_name}' in packaged app resources. ---",
                    file=sys.stderr,
                    flush=True,
                )
                return None
        except Exception as e:
            print(
                f"--- FATAL ERROR in get_binary_path (Packaged): {e} ---",
                file=sys.stderr,
                flush=True,
            )
            return None

    # Fallback for non-Windows dev environments (e.g., macOS dev)
    print(f"--- DEV MODE: Using '{binary_name}' from system PATH ---", flush=True)
    return binary_name


FFMPEG_EXE = get_binary_path("ffmpeg")

try:
    app = Flask(__name__)
    CORS(app)
    jobs = {}
    APP_TEMP_DIR = os.path.join(tempfile.gettempdir(), "yt-link")
    os.makedirs(APP_TEMP_DIR, exist_ok=True)

    def download_thread(url, ydl_opts, job_id, job_type):
        job_temp_dir = os.path.join(APP_TEMP_DIR, str(job_id))
        os.makedirs(job_temp_dir, exist_ok=True)
        jobs[job_id]["temp_dir"] = job_temp_dir

        # Use a more robust template that guarantees a numeric prefix for sorting.
        ydl_opts["outtmpl"] = os.path.join(
            job_temp_dir, "%(playlist_index)05d-%(id)s.%(ext)s"
        )

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                # --- FIX FOR TYPEERROR ---
                # Check if yt-dlp failed to extract info (e.g., due to an invalid URL from the frontend)
                info_dict = ydl.extract_info(url, download=False)
                if not info_dict:
                    raise Exception(
                        "Failed to extract video information. The URL may be invalid or private."
                    )
                # --- END FIX ---

                if "entries" in info_dict and info_dict["entries"]:
                    # Filter out None entries which can happen with unavailable videos in a playlist
                    valid_entries = [entry for entry in info_dict["entries"] if entry]
                    info_dict["entries"] = valid_entries
                    for entry in valid_entries:
                        entry["job_id"] = job_id
                else:
                    info_dict["job_id"] = job_id

                jobs[job_id]["info"] = info_dict
                ydl.download([url])

            manual_post_processing(job_id, job_type)

        except Exception as e:
            error_message = traceback.format_exc()
            print(
                f"--- [Job {job_id}] ERROR in download thread: {error_message}",
                file=sys.stderr,
                flush=True,
            )
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["error"] = str(e)

    def manual_post_processing(job_id, job_type):
        job = jobs[job_id]
        temp_dir = job["temp_dir"]
        info = job["info"]
        
        #adding in the downloading single video not as an mp3
        if job_type == "singleVideo":
            
        playlist_title = info.get("title", "yt-link-playlist")
        safe_playlist_title = sanitize_filename(playlist_title)

        if not FFMPEG_EXE:
            job.update({"status": "failed", "error": "FFMPEG executable not found."})
            raise FileNotFoundError(
                "FATAL: FFMPEG executable path was not resolved at startup."
            )

        downloaded_files = [
            os.path.join(temp_dir, f)
            for f in os.listdir(temp_dir)
            if not f.endswith((".mp3", ".zip", ".txt"))
        ]
        if not downloaded_files:
            job.update(
                {
                    "status": "failed",
                    "error": "No downloaded video files found for processing.",
                }
            )
            raise FileNotFoundError("No downloaded files found for post-processing.")

        # --- FIX FOR FILE ORDERING ---
        # Sort the downloaded files numerically based on the prefix from yt-dlp's outtmpl.
        # This ensures the files are processed in the correct playlist order.
        def sort_key(file_path):
            try:
                # Extract the numeric prefix (e.g., '00001' from '00001-videoId.webm')
                return int(os.path.basename(file_path).split("-")[0])
            except (ValueError, IndexError):
                # Fallback for files that don't match the pattern, placing them at the end.
                return float("inf")

        downloaded_files.sort(key=sort_key)
        # --- END FIX ---

        mp3_files = []
        entries = info.get("entries", [info])
        for i, file_path in enumerate(downloaded_files):
            job["message"] = (
                f"Converting file {i + 1} of {len(downloaded_files)} to MP3..."
            )

            entry_info = entries[i] if i < len(entries) else {}
            video_title = entry_info.get("title", f"track_{i + 1}")
            safe_video_title = sanitize_filename(video_title)

            # Use a consistent naming scheme for processed files
            output_filename = f"{i + 1:03d} - {safe_video_title}.mp3"
            output_filepath = os.path.join(temp_dir, output_filename)

            command = [
                FFMPEG_EXE,
                "-i",
                file_path,
                "-vn",
                "-ab",
                "192k",
                "-ar",
                "44100",
                "-y",
                output_filepath,
            ]

            process = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
            )
            if process.returncode != 0:
                raise Exception(f"FFMPEG failed for {file_path}: {process.stderr}")
            mp3_files.append(output_filepath)

        final_file_path = None
        final_file_name = None

        if job_type == "singleMp3":
            # For single files, use the video title directly without a number prefix
            single_video_title = sanitize_filename(info.get("title", "yt-link-track"))
            final_file_name = f"{single_video_title}.mp3"
            # Rename the numbered file to the final clean name
            final_file_path = os.path.join(temp_dir, final_file_name)
            os.rename(mp3_files[0], final_file_path)

        elif job_type == "playlistZip":
            job["message"] = "Creating ZIP archive..."
            final_file_name = f"{safe_playlist_title}.zip"
            final_file_path = os.path.join(temp_dir, final_file_name)
            with zipfile.ZipFile(final_file_path, "w") as zipf:
                for mp3_file in mp3_files:
                    zipf.write(mp3_file, os.path.basename(mp3_file))

        elif job_type == "combineMp3":
            job["message"] = "Combining all tracks into one MP3..."
            final_file_name = f"{safe_playlist_title} (Combined).mp3"
            final_file_path = os.path.join(temp_dir, final_file_name)

            concat_list_path = os.path.join(temp_dir, "concat_list.txt")
            with open(concat_list_path, "w", encoding="utf-8") as f:
                # The mp3_files list is already sorted correctly from above
                for mp3_file in mp3_files:
                    safe_path = mp3_file.replace("'", "'\\''")
                    f.write(f"file '{safe_path}'\n")

            combine_command = [
                FFMPEG_EXE,
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                concat_list_path,
                "-c",
                "copy",
                "-y",
                final_file_path,
            ]
            combine_process = subprocess.run(
                combine_command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
            )
            if combine_process.returncode != 0:
                raise Exception(f"FFMPEG combine failed: {combine_process.stderr}")

        job.update(
            {
                "file_path": final_file_path,
                "file_name": final_file_name,
                "status": "completed",
                "message": "Processing complete!",
            }
        )
        print(
            f"--- [Job {job_id}] Post-processing complete. Output: {final_file_name}",
            flush=True,
        )

    def progress_hook(d):
        job_id = d.get("info_dict", {}).get("job_id")
        if not job_id or job_id not in jobs:
            return

        if d["status"] == "downloading":
            percent_str = d.get("_percent_str", "0.0%").strip()
            playlist_index = d.get("info_dict", {}).get("playlist_index", 1)
            playlist_count = jobs[job_id].get("info", {}).get("playlist_count", 1)

            jobs[job_id].update(
                {
                    "status": "downloading",
                    "progress": percent_str.replace("%", ""),
                    "message": f"Downloading video {playlist_index} of {playlist_count}... {percent_str}",
                }
            )
        elif d["status"] == "finished":
            jobs[job_id].update(
                {
                    "status": "processing",
                    "message": "Download finished, converting to MP3...",
                }
            )

    @app.route("/start-job", methods=["POST"])
    def start_job_endpoint():
        data = request.get_json()
        job_id = str(uuid.uuid4())
        job_type = data.get("jobType")
        jobs[job_id] = {
            "status": "queued",
            "url": data.get("url"),
            "job_type": job_type,
        }

        ydl_opts = {
            "format": "bestaudio/best",
            "progress_hooks": [progress_hook],
            "nocheckcertificate": True,
            "ignoreerrors": job_type != "singleMp3",
            "noplaylist": job_type == "singleMp3",
            "outtmpl": os.path.join(
                APP_TEMP_DIR, str(job_id), "%(playlist_index)s-%(id)s.%(ext)s"
            ),
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,  # This disables the console progress bar that causes the error
        }

        if data.get("cookies"):
            cookie_file = os.path.join(APP_TEMP_DIR, f"cookies_{job_id}.txt")
            os.makedirs(os.path.dirname(cookie_file), exist_ok=True)
            with open(cookie_file, "w", encoding="utf-8") as f:
                f.write(data["cookies"])
            ydl_opts["cookiefile"] = cookie_file

        thread = threading.Thread(
            target=download_thread, args=(data["url"], ydl_opts, job_id, job_type)
        )
        thread.start()

        return jsonify({"jobId": job_id})

    @app.route("/job-status", methods=["GET"])
    def get_job_status():
        job_id = request.args.get("jobId")
        return jsonify(jobs.get(job_id, {"status": "not_found"}))

    @app.route("/download/<job_id>", methods=["GET"])
    def download_file(job_id):
        job = jobs.get(job_id)
        if not job or job.get("status") != "completed":
            return jsonify({"error": "File not ready or job not found"}), 404

        file_path = job.get("file_path")
        if not file_path or not os.path.exists(file_path):
            return jsonify({"error": "File not found on server."}), 404

        def file_generator():
            try:
                with open(file_path, "rb") as f:
                    yield from f
            finally:
                temp_dir = job.get("temp_dir")
                if temp_dir and os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir, ignore_errors=True)
                jobs.pop(job_id, None)

        file_name = job.get("file_name", "download.dat")

        encoded_file_name = quote(file_name)
        fallback_file_name = (
            file_name.encode("ascii", "ignore").decode("ascii").replace('"', "")
        )
        if not fallback_file_name:
            fallback_file_name = "download.dat"

        headers = {
            "Content-Disposition": f'attachment; filename="{fallback_file_name}"; filename*="UTF-8\'\'{encoded_file_name}"'
        }

        return Response(
            file_generator(), mimetype="application/octet-stream", headers=headers
        )

    if __name__ == "__main__":
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001

        if not FFMPEG_EXE:
            print(
                f"--- FATAL: FFMPEG executable could not be found. ---",
                file=sys.stderr,
                flush=True,
            )
            sys.exit(1)

        print(f"Flask-Backend-Ready:{port}", flush=True)
        app.run(host="127.0.0.1", port=port, debug=False)

except Exception as e:
    print(
        f"--- PYTHON BACKEND FATAL CRASH ---\n{traceback.format_exc()}",
        file=sys.stderr,
        flush=True,
    )
    sys.exit(1)
