import os
import shutil
import sys
import traceback
import threading
import uuid
import zipfile
import tempfile
import platform
import subprocess
import codecs
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import yt_dlp
from urllib.parse import quote
from typing import Dict, Any, List, Optional


# --- REFACTORED: Define a class for Job state management ---
# This class defines the structure of a job, resolving all of Pylance's
# "UnknownMemberType" errors and making the code type-safe.
class Job:
    def __init__(self, job_id: str, url: str, job_type: str):
        self.job_id: str = job_id
        self.url: str = url
        self.job_type: str = job_type
        self.status: str = "queued"
        self.message: str = "Job is queued..."
        self.progress: Optional[float] = None
        self.error: Optional[str] = None
        self.temp_dir: Optional[str] = None
        self.info: Optional[Dict[str, Any]] = None
        self.file_path: Optional[str] = None
        self.file_name: Optional[str] = None


# --- START: UTF-8 Encoding Fix for Packaged App ---
if sys.stdout.encoding != "utf-8":
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "strict")
if sys.stderr.encoding != "utf-8":
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "strict")
# --- END: UTF-8 Encoding Fix for Packaged App ---


def sanitize_filename(filename: str) -> str:
    """Removes characters that are invalid in Windows filenames."""
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        filename = filename.replace(char, "_")
    return filename.strip().rstrip(".")


def get_binary_path(binary_name: str) -> Optional[str]:
    """Finds the absolute path to a bundled binary."""
    # If not packaged (dev mode) and on Windows
    if not getattr(sys, "frozen", False) and platform.system() == "Windows":
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        dev_binary_path = os.path.join(project_root, "bin", f"{binary_name}.exe")
        if os.path.exists(dev_binary_path):
            print(
                f"--- DEV MODE (Windows): Using '{binary_name}' from '{dev_binary_path}' ---",
                flush=True,
            )
            return dev_binary_path

    # If in a packaged app (.pyinstaller)
    if getattr(sys, "frozen", False):
        base_path = os.path.dirname(sys.executable)
        binary_path = ""
        if platform.system() == "Darwin":
            binary_path = os.path.abspath(
                os.path.join(base_path, "..", "Resources", "bin", binary_name)
            )
        else:
            binary_path = os.path.join(base_path, "bin", binary_name)
            if platform.system() == "Windows":
                binary_path += ".exe"

        if os.path.exists(binary_path):
            print(
                f"--- BINARY FOUND: Located '{binary_name}' at '{binary_path}' ---",
                flush=True,
            )
            return binary_path

        # Fallback for different packaging structures
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

    # Fallback for non-Windows dev environments
    print(f"--- DEV MODE: Using '{binary_name}' from system PATH ---", flush=True)
    return shutil.which(binary_name)


FFMPEG_EXE = get_binary_path("ffmpeg")
app = Flask(__name__)
CORS(app)

# --- REFACTORED: Add type hints to the jobs dictionary ---
jobs: Dict[str, Job] = {}
APP_TEMP_DIR = os.path.join(tempfile.gettempdir(), "yt-link")
os.makedirs(APP_TEMP_DIR, exist_ok=True)


def download_thread(url: str, ydl_opts: Dict[str, Any], job_id: str, job_type: str):
    """Handles the download and processing in a separate thread."""
    job = jobs[job_id]
    job_temp_dir = os.path.join(APP_TEMP_DIR, job_id)
    os.makedirs(job_temp_dir, exist_ok=True)
    job.temp_dir = job_temp_dir

    if job_type in ["playlistZip", "combineMp3"]:
        ydl_opts["outtmpl"] = os.path.join(
            job_temp_dir, "%(playlist_index)05d-%(id)s.%(ext)s"
        )

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=False)
            if not info_dict:
                raise yt_dlp.utils.DownloadError(
                    "Failed to extract video information. URL may be invalid or private."
                )

            # Inject job_id into info_dict for the progress hook
            if "entries" in info_dict and info_dict.get("entries"):
                valid_entries = [entry for entry in info_dict["entries"] if entry]
                info_dict["entries"] = valid_entries
                for entry in valid_entries:
                    entry["job_id"] = job_id
            else:
                info_dict["job_id"] = job_id

            job.info = info_dict
            ydl.download([url])

        manual_post_processing(job_id, job_type)

    except Exception as e:
        error_message = traceback.format_exc()
        print(
            f"--- [Job {job_id}] ERROR in download thread: {error_message}",
            file=sys.stderr,
            flush=True,
        )
        job.status = "failed"
        job.error = str(e)


def manual_post_processing(job_id: str, job_type: str):
    """Handles file conversion, zipping, and combining after download."""
    job = jobs[job_id]
    if not job.temp_dir or not job.info:
        raise ValueError("Job temporary directory or info not set.")

    if job_type == "singleVideo":
        video_title = sanitize_filename(job.info.get("title", "yt-link-video"))
        # --- REFACTORED: Renamed to avoid shadowing ---
        downloaded_video_files = [
            os.path.join(job.temp_dir, f)
            for f in os.listdir(job.temp_dir)
            if not f.endswith((".mp3", ".zip", ".txt"))
        ]
        if not downloaded_video_files:
            raise FileNotFoundError("No downloaded video file found.")

        video_file = max(downloaded_video_files, key=os.path.getsize)
        file_ext = os.path.splitext(video_file)[1]
        job.file_name = f"{video_title}{file_ext}"
        job.file_path = os.path.join(job.temp_dir, job.file_name)
        os.rename(video_file, job.file_path)

        job.status = "completed"
        job.message = "Video download complete!"
        print(
            f"--- [Job {job_id}] Video processing complete. Output: {job.file_name}",
            flush=True,
        )
        return

    # --- Processing for MP3 jobs ---
    if not FFMPEG_EXE:
        job.status = "failed"
        job.error = "FFMPEG executable not found."
        raise FileNotFoundError("FATAL: FFMPEG executable path was not resolved.")

    playlist_title = job.info.get("title", "yt-link-playlist")
    safe_playlist_title = sanitize_filename(playlist_title)

    downloaded_files = [
        os.path.join(job.temp_dir, f)
        for f in os.listdir(job.temp_dir)
        if not f.endswith((".mp3", ".zip", ".txt"))
    ]
    if not downloaded_files:
        job.status = "failed"
        job.error = "No downloaded media files found for processing."
        raise FileNotFoundError("No downloaded files found for post-processing.")

    def sort_key(file_path: str):
        try:
            return int(os.path.basename(file_path).split("-")[0])
        except (ValueError, IndexError):
            return float("inf")

    downloaded_files.sort(key=sort_key)

    mp3_files: List[str] = []
    entries = job.info.get("entries", [job.info])
    for i, file_path in enumerate(downloaded_files):
        job.message = f"Converting file {i + 1} of {len(downloaded_files)} to MP3..."

        entry_info = entries[i] if i < len(entries) else {}
        video_title = entry_info.get("title", f"track_{i + 1}")
        safe_video_title = sanitize_filename(video_title)

        output_filename = f"{i + 1:03d} - {safe_video_title}.mp3"
        output_filepath = os.path.join(job.temp_dir, output_filename)

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
            command, capture_output=True, text=True, encoding="utf-8", errors="ignore"
        )
        if process.returncode != 0:
            raise Exception(f"FFMPEG failed for {file_path}: {process.stderr}")
        mp3_files.append(output_filepath)

    # Final packaging based on job type
    if job_type == "singleMp3":
        single_video_title = sanitize_filename(job.info.get("title", "yt-link-track"))
        job.file_name = f"{single_video_title}.mp3"
        job.file_path = os.path.join(job.temp_dir, job.file_name)
        os.rename(mp3_files[0], job.file_path)

    elif job_type == "playlistZip":
        job.message = "Creating ZIP archive..."
        job.file_name = f"{safe_playlist_title}.zip"
        job.file_path = os.path.join(job.temp_dir, job.file_name)
        with zipfile.ZipFile(job.file_path, "w") as zipf:
            for mp3_file in mp3_files:
                zipf.write(mp3_file, os.path.basename(mp3_file))

    elif job_type == "combineMp3":
        job.message = "Combining all tracks into one MP3..."
        job.file_name = f"{safe_playlist_title} (Combined).mp3"
        job.file_path = os.path.join(job.temp_dir, job.file_name)
        concat_list_path = os.path.join(job.temp_dir, "concat_list.txt")
        with open(concat_list_path, "w", encoding="utf-8") as f:
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
            job.file_path,
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

    job.status = "completed"
    job.message = "Processing complete!"
    print(
        f"--- [Job {job_id}] Post-processing complete. Output: {job.file_name}",
        flush=True,
    )


# --- REFACTORED: Add type hints for the progress hook dictionary ---
def progress_hook(d: Dict[str, Any]):
    """yt-dlp progress hook to update job status."""
    job_id = d.get("info_dict", {}).get("job_id")
    if not job_id or job_id not in jobs:
        return

    job = jobs[job_id]
    if d["status"] == "downloading":
        percent_str = d.get("_percent_str", "0.0%").strip().replace("%", "")
        speed_str = d.get("_speed_str", "N/A").strip()
        eta_str = d.get("_eta_str", "N/A").strip()

        playlist_index = d.get("info_dict", {}).get("playlist_index")
        playlist_count = job.info.get("playlist_count") if job.info else None

        message = f"Downloading: {percent_str}% at {speed_str} (ETA: {eta_str})"
        if playlist_index and playlist_count:
            message = f"Downloading {playlist_index}/{playlist_count}: {percent_str}% at {speed_str} (ETA: {eta_str})"

        # --- REFACTORED: Cleaner attribute updates ---
        job.status = "downloading"
        job.progress = float(percent_str)
        job.message = message

    elif d["status"] == "finished":
        job.status = "processing"
        job.message = "Download finished, converting file..."


@app.route("/start-job", methods=["POST"])
def start_job_endpoint():
    data = request.get_json()
    if not data or "url" not in data or "jobType" not in data:
        return jsonify({"error": "Invalid request body"}), 400

    job_id = str(uuid.uuid4())
    job_type = data["jobType"]
    url = data["url"]

    # --- REFACTORED: Create a Job instance ---
    jobs[job_id] = Job(job_id=job_id, url=url, job_type=job_type)

    ydl_opts: Dict[str, Any]
    if job_type == "singleVideo":
        ydl_opts = {
            "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "outtmpl": os.path.join(APP_TEMP_DIR, job_id, "%(id)s.%(ext)s"),
            "noplaylist": True,
        }
    else:
        ydl_opts = {
            "format": "bestaudio/best",
            "ignoreerrors": job_type != "singleMp3",
            "noplaylist": job_type == "singleMp3",
            "outtmpl": os.path.join(
                APP_TEMP_DIR, job_id, "%(id)s.%(ext)s"
            ),  # Playlist template is now set in download_thread
        }

    # Common options
    ydl_opts.update(
        {
            "progress_hooks": [progress_hook],
            "nocheckcertificate": True,
            "quiet": True,
            "no_warnings": True,
        }
    )

    if data.get("cookies"):
        cookie_file = os.path.join(APP_TEMP_DIR, f"cookies_{job_id}.txt")
        with open(cookie_file, "w", encoding="utf-8") as f:
            f.write(data["cookies"])
        ydl_opts["cookiefile"] = cookie_file

    thread = threading.Thread(
        target=download_thread, args=(url, ydl_opts, job_id, job_type)
    )
    thread.start()
    return jsonify({"jobId": job_id})


@app.route("/job-status", methods=["GET"])
def get_job_status():
    job_id = request.args.get("jobId")
    if not job_id:
        return jsonify(
            {"status": "not_found", "error": "jobId query parameter is required."}
        ), 400

    job = jobs.get(job_id)
    if job:
        # --- REFACTORED: Return job state as a dictionary ---
        return jsonify(job.__dict__)
    return jsonify({"status": "not_found"})


@app.route("/download/<job_id>", methods=["GET"])
def download_file(job_id: str):
    job = jobs.get(job_id)
    if not job or job.status != "completed" or not job.file_path or not job.file_name:
        return jsonify({"error": "File not ready or job not found"}), 404

    if not os.path.exists(job.file_path):
        return jsonify({"error": "File not found on server."}), 404

    def file_generator(file_path: str, temp_dir: Optional[str]):
        try:
            with open(file_path, "rb") as f:
                yield from f
        finally:
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
            jobs.pop(job_id, None)

    encoded_file_name = quote(job.file_name)
    fallback_file_name = (
        job.file_name.encode("ascii", "ignore").decode("ascii").replace('"', "")
        or "download.dat"
    )

    headers = {
        "Content-Disposition": f'attachment; filename="{fallback_file_name}"; filename*="UTF-8\'\'{encoded_file_name}"'
    }
    return Response(
        file_generator(job.file_path, job.temp_dir),
        mimetype="application/octet-stream",
        headers=headers,
    )


if __name__ == "__main__":
    if not FFMPEG_EXE:
        print(
            "--- FATAL: FFMPEG executable could not be found. ---",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    print(f"Flask-Backend-Ready:{port}", flush=True)
    app.run(host="127.0.0.1", port=port, debug=False)
