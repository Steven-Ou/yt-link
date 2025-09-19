import logging
import os
import re
import shutil
import sys
import threading
import time
import uuid
import zipfile
from typing import Any, Dict, List, Optional

import yt_dlp
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# --- Configuration ---
app = Flask(__name__)
CORS(app)

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)

# --- Global State ---
jobs: Dict[str, Dict[str, Any]] = {}
BASE_DOWNLOAD_PATH: str = os.path.join(os.getcwd(), "downloads")
if not os.path.exists(BASE_DOWNLOAD_PATH):
    os.makedirs(BASE_DOWNLOAD_PATH)


# --- Helper Functions ---
def sanitize_filename(filename: str) -> str:
    """
    Sanitizes a string to be a valid filename.
    - Removes illegal characters.
    - Replaces whitespace with underscores.
    - Limits length to 200 characters to be safe.
    """
    sanitized: str = re.sub(r'[\\/*?:"<>|]', "", filename)
    sanitized = re.sub(r"\s+", "_", sanitized)
    return sanitized[:200]


def get_video_title(video_url: str, cookies_path: Optional[str] = None) -> str:
    """Gets the video title without downloading the full video."""
    ydl_opts: Dict[str, Any] = {
        "quiet": True,
        "skip_download": True,
        "force_generic_extractor": False,
    }
    if cookies_path:
        ydl_opts["cookiefile"] = cookies_path

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict: Dict[str, Any] = ydl.extract_info(video_url, download=False)
            return info_dict.get("title", "untitled")
    except Exception as e:
        logging.error(f"Error fetching video title: {e}")
        return "untitled"


def update_job_status(
    job_id: str,
    status: str,
    message: Optional[str] = None,
    progress: Optional[float] = None,
    error: Optional[str] = None,
) -> None:
    """Safely updates the job's status."""
    if job_id in jobs:
        jobs[job_id]["status"] = status
        if message:
            jobs[job_id]["message"] = message
        if progress:
            jobs[job_id]["progress"] = progress
        if error:
            jobs[job_id]["error"] = error
        jobs[job_id]["last_updated"] = time.time()
    else:
        logging.warning(f"Attempted to update a non-existent job: {job_id}")


def progress_hook(d: Dict[str, Any]) -> None:
    """yt-dlp progress hook to update job status."""
    job_id: Optional[str] = d.get("job_id")
    if job_id and d["status"] == "downloading":
        try:
            progress_str: str = d["_percent_str"].strip().replace("%", "")
            progress = float(progress_str)
            update_job_status(
                job_id,
                "downloading",
                message=(
                    f"Downloading: {d['_percent_str']} of {d['_total_bytes_str']} at"
                    f" {d['_speed_str']}"
                ),
                progress=progress,
            )
        except (ValueError, KeyError):
            update_job_status(job_id, "downloading", message="Downloading stream...")


def find_media_files(directory: str) -> List[str]:
    """Finds media files in a directory."""
    media_files: List[str] = []
    for f in os.listdir(directory):
        if f.endswith((".mp3", ".mp4", ".mkv", ".webm", ".m4a")):
            media_files.append(os.path.join(directory, f))
    return media_files


def manual_post_processing(job_id: str, job_type: str) -> None:
    """Handles post-processing for jobs that need it (zip, combine)."""
    job_path: str = os.path.join(BASE_DOWNLOAD_PATH, job_id)
    media_files: List[str] = find_media_files(job_path)

    if not media_files:
        raise FileNotFoundError("No media files found for post-processing.")

    if job_type == "playlistZip":
        update_job_status(job_id, "processing", message="Zipping files...")
        zip_path: str = f"{job_path}.zip"
        with zipfile.ZipFile(zip_path, "w") as zipf:
            for file in media_files:
                zipf.write(file, os.path.basename(file))
        jobs[job_id]["final_filename"] = os.path.basename(zip_path)
        shutil.rmtree(job_path)  # Clean up original folder

    elif job_type == "combineMp3":
        update_job_status(job_id, "processing", message="Combining MP3 files...")
        # Assume the title from the first video for the final filename
        output_filename = (
            f"{os.path.basename(os.path.splitext(media_files[0])[0])}_combined.mp3"
        )
        output_path = os.path.join(BASE_DOWNLOAD_PATH, job_id, output_filename)

        # Create a file list for ffmpeg
        filelist_path = os.path.join(job_path, "filelist.txt")
        with open(filelist_path, "w") as f:
            for media_file in sorted(media_files):
                f.write(f"file '{os.path.basename(media_file)}'\n")

        # ffmpeg command
        ffmpeg_cmd = [
            jobs[job_id]["ffmpeg_path"],
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            filelist_path,
            "-c",
            "copy",
            output_path,
        ]

        # This part should be improved with proper subprocess handling in a real app
        os.system(" ".join(f'"{part}"' for part in ffmpeg_cmd))

        jobs[job_id]["final_filename"] = output_filename


# --- Download Logic ---
def download_thread(
    job_id: str,
    url: str,
    job_type: str,
    ffmpeg_path: str,
    quality: Optional[str] = None,
    cookies_path: Optional[str] = None,
) -> None:
    """The main thread for handling a download job."""
    update_job_status(job_id, "processing", "Fetching video information...")
    job_path: str = os.path.join(BASE_DOWNLOAD_PATH, job_id)
    os.makedirs(job_path, exist_ok=True)

    title: str = get_video_title(url, cookies_path)
    sanitized_title: str = sanitize_filename(title)

    # Common ydl_opts
    ydl_opts: Dict[str, Any] = {
        "progress_hooks": [lambda d: progress_hook(d)],
        "job_id": job_id,
        "outtmpl": os.path.join(job_path, f"{sanitized_title}.%(ext)s"),
    }
    if cookies_path:
        ydl_opts["cookiefile"] = cookies_path

    # Job-specific ydl_opts
    if job_type == "singleMp3":
        ydl_opts.update(
            {
                "format": "bestaudio/best",
                "postprocessors": [
                    {"key": "FFmpegExtractAudio", "preferredcodec": "mp3"}
                ],
            }
        )
    elif job_type == "playlistZip":
        ydl_opts.update(
            {
                "format": "bestaudio/best",
                "postprocessors": [
                    {"key": "FFmpegExtractAudio", "preferredcodec": "mp3"}
                ],
                "outtmpl": os.path.join(
                    job_path, "%(playlist_index)s-%(title)s.%(ext)s"
                ),
            }
        )
    elif job_type == "combineMp3":
        ydl_opts.update(
            {
                "format": "bestaudio/best",
                "postprocessors": [
                    {"key": "FFmpegExtractAudio", "preferredcodec": "mp3"}
                ],
                "outtmpl": os.path.join(
                    job_path, "%(playlist_index)s-%(title)s.%(ext)s"
                ),
            }
        )
    elif job_type == "singleVideo":
        video_format = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        if quality and quality != "best":
            video_format = f"bestvideo[height<={quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<={quality}][ext=mp4]/best"
        ydl_opts["format"] = video_format

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        if job_type in ["playlistZip", "combineMp3"]:
            manual_post_processing(job_id, job_type)
        else:
            media_files = find_media_files(job_path)
            if not media_files:
                raise FileNotFoundError("Download completed, but no file was found.")
            jobs[job_id]["final_filename"] = os.path.basename(media_files[0])

        update_job_status(job_id, "completed", "Download finished successfully.")

    except Exception as e:
        logging.error(
            f"--- [Job {job_id}] ERROR in download thread: {e}", exc_info=True
        )
        update_job_status(job_id, "failed", error=str(e))

    finally:
        if cookies_path and os.path.exists(cookies_path):
            os.remove(cookies_path)


# --- API Endpoints ---
@app.route("/start-job", methods=["POST"])
def start_job_route() -> Any:
    data: Dict[str, Any] = request.json
    url: Optional[str] = data.get("url")
    job_type: Optional[str] = data.get("jobType")
    quality: Optional[str] = data.get("quality")
    cookies: Optional[str] = data.get("cookies")

    if not url or not job_type:
        return jsonify({"error": "URL and jobType are required"}), 400

    job_id: str = str(uuid.uuid4())
    cookies_path: Optional[str] = None
    if cookies:
        cookies_path = os.path.join(BASE_DOWNLOAD_PATH, f"cookies_{job_id}.txt")
        with open(cookies_path, "w") as f:
            f.write(cookies)

    # This should be configured more robustly
    ffmpeg_path = sys.argv[2] if len(sys.argv) > 2 else "ffmpeg"

    jobs[job_id] = {
        "status": "queued",
        "type": job_type,
        "url": url,
        "ffmpeg_path": ffmpeg_path,
    }

    thread = threading.Thread(
        target=download_thread,
        args=(job_id, url, job_type, ffmpeg_path, quality, cookies_path),
    )
    thread.start()

    return jsonify({"jobId": job_id})


@app.route("/job-status", methods=["GET"])
def job_status_route() -> Any:
    job_id: Optional[str] = request.args.get("jobId")
    if not job_id:
        return jsonify({"error": "jobId is required"}), 400
    job: Optional[Dict[str, Any]] = jobs.get(job_id)
    if not job:
        return jsonify({"status": "not_found", "error": "Job not found"}), 404
    return jsonify(job)


@app.route("/download-file", methods=["GET"])
def download_file_route() -> Any:
    job_id: Optional[str] = request.args.get("jobId")
    if not job_id:
        return jsonify({"error": "jobId is required"}), 400

    job: Optional[Dict[str, Any]] = jobs.get(job_id)
    if not job or job["status"] != "completed":
        return jsonify({"error": "File not ready or job not found"}), 404

    final_filename: Optional[str] = job.get("final_filename")
    if not final_filename:
        return jsonify({"error": "Final filename not found for job"}), 404

    directory: str
    if final_filename.endswith(".zip"):
        directory = BASE_DOWNLOAD_PATH
    else:
        directory = os.path.join(BASE_DOWNLOAD_PATH, job_id)

    if not os.path.exists(os.path.join(directory, final_filename)):
        return jsonify({"error": "File not found on server"}), 404

    return send_from_directory(directory, final_filename, as_attachment=True)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    app.run(debug=False, port=port)
