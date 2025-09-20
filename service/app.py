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

# This will be set at runtime from the command line arguments
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
    now = time.time()
    for dirname in os.listdir(APP_TEMP_DIR):
        dirpath = os.path.join(APP_TEMP_DIR, dirname)
        if os.path.isdir(dirpath):
            try:
                uuid.UUID(dirname, version=4)
                dir_age = now - os.path.getmtime(dirpath)
                if dir_age > 86400:  # 24 hours
                    print(f"Cleaning up old temp directory: {dirpath}")
                    shutil.rmtree(dirpath, ignore_errors=True)
            except (ValueError, OSError):
                continue


cleanup_old_job_dirs()


# --- Flask Routes ---


@app.route("/get-formats", methods=["POST"])
def get_formats_endpoint():
    data = request.get_json()
    if not data or "url" not in data:
        return jsonify({"error": "Invalid request, URL is required."}), 400
    url = data["url"]
    try:
        ydl_opts = {"quiet": True, "no_warnings": True, "nocheckcertificate": True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False) or {}
            unique_formats = {}
            all_formats = info.get("formats", [])

            def get_height(f):
                return f.get("height") or 0

            all_formats.sort(key=get_height, reverse=True)
            for f in all_formats:
                height = get_height(f)
                if not height or height in unique_formats:
                    continue
                if f.get("vcodec") != "none":
                    filesize = f.get("filesize") or f.get("filesize_approx")
                    note = f.get("ext", "unknown")
                    if filesize:
                        filesize_mb = filesize / (1024 * 1024)
                        note = f"{note} (~{filesize_mb:.1f} MB)"
                    note += (
                        " (video+audio)"
                        if f.get("acodec") != "none"
                        else " (video-only)"
                    )
                    unique_formats[height] = {
                        "format_id": f.get("format_id"),
                        "ext": f.get("ext"),
                        "resolution": f"{height}p",
                        "height": height,
                        "note": note,
                    }
            final_formats = sorted(
                unique_formats.values(), key=lambda x: x["height"], reverse=True
            )
            return jsonify(final_formats)
    except yt_dlp.utils.DownloadError as e:
        return jsonify({"error": "Video not found or unavailable."}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/start-job", methods=["POST"])
def start_job_endpoint():
    data = request.get_json()
    if not data or "url" not in data or "jobType" not in data:
        return jsonify({"error": "Invalid request body"}), 400

    job_id = str(uuid.uuid4())
    job_type = data["jobType"]
    jobs[job_id] = Job(job_id=job_id, url=data["url"], job_type=job_type)

    output_template = os.path.join(APP_TEMP_DIR, job_id, "%(title)s.%(ext)s")
    if job_type in ["playlistZip", "combineMp3"]:
        output_template = os.path.join(
            APP_TEMP_DIR, job_id, "%(playlist_index)03d-%(title)s.%(ext)s"
        )

    ydl_opts: Dict[str, Any] = {
        "progress_hooks": [progress_hook],
        "nocheckcertificate": True,
        "quiet": True,
        "no_warnings": True,
        "ffmpeg_location": ffmpeg_exe,
        "retries": 10,
        "fragment_retries": 10,
    }

    if job_type == "singleVideo":
        quality = data.get("quality", "best")
        format_string = (
            f"bestvideo[height<={quality}]+bestaudio/best[height<={quality}]"
            if quality != "best"
            else "bestvideo+bestaudio/best"
        )
        ydl_opts.update(
            {
                "format": format_string,
                "outtmpl": output_template,
                "noplaylist": True,
                "postprocessor_args": {
                    "merge": ["-c:v", "libx264", "-c:a", "aac", "-preset", "fast"]
                },
                "merge_output_format": "mp4",
            }
        )
    else:  # All audio jobs
        ydl_opts.update(
            {
                "format": "bestaudio/best",
                "outtmpl": output_template,
                "noplaylist": job_type == "singleMp3",
                "ignoreerrors": job_type != "singleMp3",
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "192",
                    }
                ],
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
    job = jobs.get(job_id)
    if (
        not job
        or job.status != "completed"
        or not job.file_path
        or not os.path.exists(job.file_path)
    ):
        return jsonify({"error": "Job not found, not ready, or file is missing."}), 404

    def file_generator(file_path: str, temp_dir: Optional[str]):
        try:
            with open(file_path, "rb") as f:
                yield from f
        finally:
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
            jobs.pop(job_id, None)
            print(f"Cleaned up job and temp files for job_id: {job_id}")

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


def download_thread(url: str, ydl_opts: Dict[str, Any], job_id: str, job_type: str):
    job = jobs[job_id]
    job.temp_dir = os.path.join(APP_TEMP_DIR, job_id)
    os.makedirs(job.temp_dir, exist_ok=True)
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=False)
            if not info_dict:
                raise DownloadError("Failed to extract video information.")

            # Attach job_id for the progress hook
            entries = info_dict.get("entries", [info_dict])
            for entry in entries:
                if isinstance(entry, dict):
                    entry["job_id"] = job_id
            job.info = info_dict

            ydl.download([url])
        finalize_job(job_id, job_type)
    except Exception:
        job.status = "failed"
        job.error = traceback.format_exc()
        print(f"--- [Job {job_id}] ERROR: {job.error}", file=sys.stderr, flush=True)


def finalize_job(job_id: str, job_type: str):
    job = jobs[job_id]
    assert job.temp_dir and job.info, "Job temp_dir or info is not set"

    if job_type == "singleVideo":
        found_files = [f for f in os.listdir(job.temp_dir) if f.endswith(".mp4")]
        if not found_files:
            job.status = "failed"
            job.error = "No final MP4 file found after download."
            return
        job.file_name = found_files[0]
        job.file_path = os.path.join(job.temp_dir, job.file_name)
    else:  # Audio jobs
        mp3_files = sorted(
            [
                os.path.join(job.temp_dir, f)
                for f in os.listdir(job.temp_dir)
                if f.endswith(".mp3")
            ]
        )
        if not mp3_files:
            job.status = "failed"
            job.error = "No MP3 files found after conversion."
            return

        playlist_title = sanitize_filename(job.info.get("title", "playlist"))

        if job_type == "singleMp3":
            job.file_name = os.path.basename(mp3_files[0])
            job.file_path = mp3_files[0]
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
            with open(concat_list_path, "w", encoding="utf-8") as f:
                for mp3_file in mp3_files:
                    f.write(f"file '{mp3_file.replace("'", "'\\''")}'\n")

            command = [
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
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
            )
            if process.returncode != 0:
                raise Exception(f"FFMPEG Concat Error: {process.stderr}")

    job.status, job.message = "completed", "Processing complete!"


def progress_hook(d: Dict[str, Any]):
    job_id = d.get("info_dict", {}).get("job_id")
    if not job_id or job_id not in jobs:
        return
    job = jobs[job_id]

    if d["status"] == "downloading":
        job.status = "downloading"
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if total:
            job.progress = d.get("downloaded_bytes", 0) / total * 100
        job.message = f"Downloading: {d.get('_percent_str', 'N/A')} at {d.get('_speed_str', 'N/A')}"
    elif d["status"] == "finished":
        job.status = "processing"
        job.message = "Download finished, converting..."


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("FATAL: Missing port and FFmpeg path.", file=sys.stderr, flush=True)
        sys.exit(1)

    port_arg, ffmpeg_path_arg = sys.argv[1], sys.argv[2]

    if not os.path.exists(ffmpeg_path_arg):
        print(
            f"FATAL: FFmpeg path does not exist: '{ffmpeg_path_arg}'",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)

    ffmpeg_exe = ffmpeg_path_arg
    port = int(port_arg)

    print(f"--- Backend starting on port {port} ---", flush=True)
    print(f"--- Using FFmpeg from: {ffmpeg_exe} ---", flush=True)
    print(f"Flask-Backend-Ready:{port}", flush=True)
    app.run(host="127.0.0.1", port=port, debug=False)
