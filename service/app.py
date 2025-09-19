# service/app.py

import os
import shutil
import sys
import traceback
import threading
import uuid
import zipfile
import tempfile
import subprocess
import codecs
import time
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import yt_dlp
from yt_dlp.utils import DownloadError
from urllib.parse import quote
from typing import Dict, Any, List, Optional, Generator

# Renamed to lowercase to signify it's a mutable variable set at runtime
ffmpeg_exe: Optional[str] = None


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


# --- UTF-8 Fix and Helper Functions ---
if sys.stdout.encoding != "utf-8":
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "strict")
if sys.stderr.encoding != "utf-8":
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "strict")


def sanitize_filename(filename: str) -> str:
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        filename = filename.replace(char, "_")
    return filename.strip().rstrip(".")


app = Flask(__name__)
CORS(app)
jobs: Dict[str, Job] = {}
APP_TEMP_DIR = os.path.join(tempfile.gettempdir(), "yt-link")
os.makedirs(APP_TEMP_DIR, exist_ok=True)


# --- Startup Cleanup ---
def cleanup_old_job_dirs():
    """
    Removes temporary job directories older than 24 hours on startup.
    This prevents orphaned files from force-quits from accumulating.
    """
    now = time.time()
    for dirname in os.listdir(APP_TEMP_DIR):
        dirpath = os.path.join(APP_TEMP_DIR, dirname)
        if os.path.isdir(dirpath):
            try:
                # Check if directory name is a valid UUID to be safer
                uuid.UUID(dirname, version=4)
                dir_age = now - os.path.getmtime(dirpath)
                if dir_age > 86400:  # 24 hours in seconds
                    print(f"Cleaning up old temp directory: {dirpath}")
                    shutil.rmtree(dirpath, ignore_errors=True)
            except (ValueError, OSError):
                # Not a valid job folder or error during removal, skip
                continue


cleanup_old_job_dirs()


# --- Flask Routes ---


@app.route("/get-formats", methods=["POST"])
def get_formats_endpoint():
    """
    Retrieves available video formats for a given YouTube URL.
    This endpoint is designed to find all unique video resolutions,
    prioritizing high-quality video-only streams and merging them
    with available combined (video+audio) streams.
    """
    data = request.get_json()
    if not data or "url" not in data:
        return jsonify({"error": "Invalid request, URL is required."}), 400

    url = data["url"]

    try:
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "nocheckcertificate": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False) or {}

            unique_formats = {}
            all_formats = info.get("formats", [])

            # Helper to safely get height for sorting, defaulting None to 0
            def get_height(f):
                return f.get("height") or 0

            # Sort all formats by height to process best quality first
            all_formats.sort(key=get_height, reverse=True)

            for f in all_formats:
                height = get_height(f)
                # Skip formats without resolution or if we already have this resolution
                if not height or height in unique_formats:
                    continue

                # We only want formats that contain a video stream
                if f.get("vcodec") != "none":
                    filesize = f.get("filesize") or f.get("filesize_approx")
                    note = f.get("ext", "unknown")

                    if filesize:
                        # Convert bytes to a readable MB format
                        filesize_mb = filesize / (1024 * 1024)
                        note = f"{note} (~{filesize_mb:.1f} MB)"

                    if f.get("acodec") == "none":
                        note = f"{note} (video-only)"
                    else:
                        note = f"{note} (video+audio)"

                    unique_formats[height] = {
                        "format_id": f.get("format_id"),
                        "ext": f.get("ext"),
                        "resolution": f"{height}p",
                        "height": height,
                        "note": note,
                    }

            # Sort the final list from highest to lowest resolution for the UI
            final_formats = sorted(
                unique_formats.values(), key=lambda x: x["height"], reverse=True
            )
            return jsonify(final_formats)

    except yt_dlp.utils.DownloadError as e:
        print(f"DownloadError on get-formats: {e}")
        return jsonify({"error": "Video not found or unavailable."}), 404
    except Exception as e:
        # Log the full traceback for better debugging
        traceback.print_exc()
        print(f"Generic error on get-formats: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/start-job", methods=["POST"])
def start_job_endpoint():
    data = request.get_json()
    if not data or "url" not in data or "jobType" not in data:
        return jsonify({"error": "Invalid request body"}), 400

    job_id = str(uuid.uuid4())
    job_type = data["jobType"]
    jobs[job_id] = Job(job_id=job_id, url=data["url"], job_type=job_type)

    ydl_opts: Dict[str, Any]

    # Use the video ID in the filename template for reliable matching later
    output_template = os.path.join(APP_TEMP_DIR, job_id, "%(id)s.%(ext)s")
    if job_type in ["playlistZip", "combineMp3"]:
        output_template = os.path.join(
            APP_TEMP_DIR, job_id, "%(playlist_index)s-%(id)s.%(ext)s"
        )

    if job_type == "singleVideo":
        quality = data.get("quality", "best")
        format_string = (
            f"bestvideo[height<={quality}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
            if quality != "best"
            else "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        )
        ydl_opts = {
            "format": format_string,
            "outtmpl": output_template,
            "noplaylist": True,
        }

    elif job_type == "singleMp3":
        ydl_opts = {
            "format": "bestaudio[ext=m4a]/bestaudio",
            "outtmpl": output_template,
            "noplaylist": True,
        }

    else:  # Handles playlistZip and combineMp3
        ydl_opts = {
            "format": "bestaudio[ext=m4a]/bestaudio",
            "outtmpl": output_template,
            "noplaylist": False,
            "ignoreerrors": True,  # Keep this to skip unavailable videos
        }

    ydl_opts.update(
        {
            "progress_hooks": [progress_hook],
            "nocheckcertificate": True,
            "quiet": True,
            "no_warnings": True,
            "http_headers": {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            },
        }
    )

    if data.get("cookies"):
        cookie_file = os.path.join(APP_TEMP_DIR, f"cookies_{job_id}.txt")
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
    if not job_id or job_id not in jobs:
        return jsonify({"status": "not_found"}), 404
    return jsonify(jobs[job_id].__dict__)


@app.route("/download/<job_id>", methods=["GET"])
def download_file_route(job_id: str):
    print(f"Download request received for job_id: {job_id}")
    job = jobs.get(job_id)

    if not job:
        print(f"Job not found for job_id: {job_id}")
        return jsonify({"error": "Job not found"}), 404

    if job.status != "completed":
        print(f"Job {job_id} not completed. Status is: {job.status}")
        return jsonify({"error": "File not ready"}), 404

    file_path = job.file_path
    file_name = job.file_name

    if not file_path or not os.path.exists(file_path):
        print(f"File not found on server at path: {file_path}")
        return jsonify({"error": "File not found on server."}), 404

    print(f"File found: {file_path}. Preparing to send.")

    def file_generator(
        file_path: str, temp_dir: Optional[str]
    ) -> Generator[bytes, None, None]:
        try:
            with open(file_path, "rb") as f:
                yield from f
        finally:
            # Cleanup is now primarily handled by the thread, but this is a good fallback.
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
            jobs.pop(job_id, None)
            print(f"Cleaned up job and temp files for job_id: {job_id}")

    encoded_file_name = quote(file_name)
    fallback_file_name = (
        file_name.encode("ascii", "ignore").decode("ascii").replace('"', "")
        or "download.dat"
    )
    headers = {
        "Content-Disposition": f'attachment; filename="{fallback_file_name}"; filename*="UTF-8\'\'{encoded_file_name}"'
    }
    return Response(
        file_generator(file_path, job.temp_dir),
        mimetype="application/octet-stream",
        headers=headers,
    )


def download_thread(url: str, ydl_opts: Dict[str, Any], job_id: str, job_type: str):
    job = jobs[job_id]
    job.temp_dir = os.path.join(APP_TEMP_DIR, job_id)
    os.makedirs(job.temp_dir, exist_ok=True)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=False)
            if not info_dict:
                raise DownloadError("Failed to extract video information.")

            # Attach job_id to each entry for the progress hook
            entries = info_dict.get("entries")
            if isinstance(entries, list):
                valid_entries = [entry for entry in entries if isinstance(entry, dict)]
                for entry in valid_entries:
                    entry["job_id"] = job_id
                info_dict["entries"] = valid_entries
            else:
                info_dict["job_id"] = job_id

            job.info = info_dict
            ydl.download([url])

        manual_post_processing(job_id, job_type)

    except Exception:
        job.status = "failed"
        job.error = traceback.format_exc()
        print(
            f"--- [Job {job_id}] ERROR in download thread: {job.error}",
            file=sys.stderr,
            flush=True,
        )
    # The 'finally' block is NOT ideal here for cleanup because a successful download
    # needs the files to stick around. Cleanup now happens on startup and after download.


def manual_post_processing(job_id: str, job_type: str):
    job = jobs[job_id]
    assert job.temp_dir and job.info, "Job temp_dir or info is not set"

    if not ffmpeg_exe or not os.path.exists(ffmpeg_exe):
        job.status, job.error = "failed", "FFMPEG executable not found"
        raise FileNotFoundError(job.error)

    ignore_extensions = (".mp3", ".zip", ".txt", ".part", ".mp4")
    downloaded_files = [
        os.path.join(job.temp_dir, f)
        for f in os.listdir(job.temp_dir)
        if not f.endswith(ignore_extensions)
    ]

    if not downloaded_files:
        job.status = "failed"
        job.error = "No media files found after download. The video may be protected, private, or in an unsupported format."
        files_in_dir = os.listdir(job.temp_dir)
        print(
            f"--- [Job {job_id}] ERROR: No media files found. Contents of temp dir: {files_in_dir}",
            file=sys.stderr,
            flush=True,
        )
        return

    if job_type == "singleVideo":
        video_title = sanitize_filename(job.info.get("title", "video"))
        job.file_name = f"{video_title}.mp4"
        job.file_path = os.path.join(job.temp_dir, job.file_name)

        # Downloaded files may be separate video and audio streams
        if len(downloaded_files) > 1:
            job.message = "Merging video and audio streams..."
            # Simple assumption: largest is video, smallest is audio
            video_stream = max(downloaded_files, key=os.path.getsize)
            audio_stream = min(downloaded_files, key=os.path.getsize)
            command = [
                ffmpeg_exe,
                "-i",
                video_stream,
                "-i",
                audio_stream,
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-y",
                job.file_path,
            ]
        else:  # Or a single combined file
            job.message = "Processing video..."
            command = [
                ffmpeg_exe,
                "-i",
                downloaded_files[0],
                "-c",
                "copy",
                "-y",
                job.file_path,
            ]

        process = subprocess.run(
            command, capture_output=True, text=True, encoding="utf-8", errors="ignore"
        )
        if process.returncode != 0:
            job.status, job.error = "failed", f"FFMPEG Error: {process.stderr}"
            raise Exception(job.error)

    else:  # Handles all audio jobs: singleMp3, playlistZip, combineMp3
        process_audio_job(job, job_type, downloaded_files)

    job.status, job.message = "completed", "Processing complete!"


def process_audio_job(job: Job, job_type: str, downloaded_files: List[str]):
    """Refactored logic for handling audio processing."""
    assert job.temp_dir and job.info, "Job temp_dir or info is not set"

    playlist_title = sanitize_filename(job.info.get("title", "playlist"))

    # Create a mapping from video ID to its metadata entry
    entries_list = job.info.get("entries", [job.info])
    entries_map = {entry.get("id"): entry for entry in entries_list if entry}

    mp3_files = []
    total_files = len(downloaded_files)

    for i, file_path in enumerate(downloaded_files):
        job.message = f"Converting file {i + 1}/{total_files} to MP3..."

        # Extract video ID from filename (e.g., '1-dQw4w9WgXcQ.m4a' -> 'dQw4w9WgXcQ')
        base_name = os.path.basename(file_path)
        video_id = os.path.splitext(base_name.split("-", 1)[-1])[0]

        entry_info = entries_map.get(video_id, {})
        video_title = sanitize_filename(entry_info.get("title", f"track_{i + 1}"))

        # Using playlist index from filename for consistent ordering
        playlist_index_str = base_name.split("-", 1)[0]
        prefix = (
            f"{int(playlist_index_str):03d}"
            if playlist_index_str.isdigit()
            else f"{i+1:03d}"
        )

        output_filename = f"{prefix} - {video_title}.mp3"
        output_filepath = os.path.join(job.temp_dir, output_filename)

        command = [
            ffmpeg_exe,
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
        subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            encoding="utf-8",
            errors="ignore",
        )
        mp3_files.append(output_filepath)

    if not mp3_files:
        raise Exception("MP3 conversion failed for all files.")

    if job_type == "singleMp3":
        job.file_name = f"{sanitize_filename(job.info.get('title', 'track'))}.mp3"
        job.file_path = os.path.join(job.temp_dir, job.file_name)
        # BUG FIX: Corrected job.file_.name to job.file_name
        os.rename(mp3_files[0], job.file_path)

    elif job_type == "playlistZip":
        job.message = "Creating ZIP archive..."
        job.file_name = f"{playlist_title}.zip"
        job.file_path = os.path.join(job.temp_dir, job.file_name)
        with zipfile.ZipFile(job.file_path, "w") as zipf:
            for mp3_file in mp3_files:
                zipf.write(mp3_file, os.path.basename(mp3_file))

    elif job_type == "combineMp3":
        job.message = "Combining all tracks..."
        job.file_name = f"{playlist_title} (Combined).mp3"
        job.file_path = os.path.join(job.temp_dir, job.file_name)
        concat_list_path = os.path.join(job.temp_dir, "concat_list.txt")

        # Sort mp3 files by the numeric prefix to ensure correct order
        mp3_files.sort()

        with open(concat_list_path, "w", encoding="utf-8") as f:
            for mp3_file in mp3_files:
                # FFmpeg concat demuxer requires special escaping for characters like single quotes
                escaped_filename = mp3_file.replace("'", "'\\''")
                f.write(f"file '{escaped_filename}'\n")

        combine_command = [
            ffmpeg_exe,
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
        process = subprocess.run(
            combine_command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
        )
        if process.returncode != 0:
            job.status, job.error = "failed", f"FFMPEG Concat Error: {process.stderr}"
            raise Exception(job.error)


def progress_hook(d: Dict[str, Any]):
    if "info_dict" in d:
        job_id = d["info_dict"].get("job_id")
        if not job_id or job_id not in jobs:
            return

        job = jobs[job_id]
        if d["status"] == "downloading":
            job.status = "downloading"
            if d.get("total_bytes"):
                job.progress = d.get("downloaded_bytes", 0) / d["total_bytes"] * 100
            elif d.get("total_bytes_estimate"):
                job.progress = (
                    d.get("downloaded_bytes", 0) / d["total_bytes_estimate"] * 100
                )

            job.message = f"Downloading: {d.get('_percent_str', 'N/A')} at {d.get('_speed_str', 'N/A')} (ETA: {d.get('_eta_str', 'N/A')})"

        elif d["status"] == "finished":
            job.status = "processing"
            job.message = "Download finished, preparing to process..."


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(
            "FATAL: Not enough arguments. Expected port and FFmpeg path.",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)

    port_arg, ffmpeg_path_arg = sys.argv[1], sys.argv[2]

    if not os.path.exists(ffmpeg_path_arg):
        print(
            f"FATAL: Provided FFmpeg path does not exist: '{ffmpeg_path_arg}'",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)

    ffmpeg_exe = ffmpeg_path_arg
    port = int(port_arg)

    print(f"--- Python backend starting on port {port} ---", flush=True)
    print(f"--- Using FFmpeg from path: {ffmpeg_exe} ---", flush=True)
    print(f"Flask-Backend-Ready:{port}", flush=True)

    app.run(host="127.0.0.1", port=port, debug=False)
