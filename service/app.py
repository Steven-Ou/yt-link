# service/app.py
import codecs
import os
import shutil
import sys
import tempfile
import threading
import time
import traceback
import uuid
import zipfile
import subprocess
from typing import Any, Dict, Generator, List, Optional, cast

from flask import Flask, Response, request, jsonify
from flask_cors import CORS

import yt_dlp  # type: ignore[import]
from yt_dlp.utils import DownloadError  # type: ignore[import]
from urllib.parse import quote

# This will be set at runtime from the command line arguments
ffmpeg_exe: Optional[str] = None


class Job:
    def __init__(self, job_id: str, url: str, job_type: str) -> None:
        self.job_id: str = job_id
        self.url: str = url
        self.job_type: str = job_type
        self.status: str = "queued"
        self.message: str = "Job is queued..."
        self.progress: Optional[float] = None
        self.error: Optional[str] = None
        # temp_dir is set per-job at runtime
        self.temp_dir: Optional[str] = None
        # yt_dlp returns a complex info object; annotate as Any to avoid type conflict
        self.info: Optional[Any] = None
        self.file_path: Optional[str] = None
        self.file_name: Optional[str] = None


# --- UTF-8 Fix for environments where stdout/stderr are non-UTF8 ---
# if sys.stdout.encoding != "utf-8":
#  sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "strict")  # type: ignore[arg-type]


def sanitize_filename(filename: str) -> str:
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        filename = filename.replace(char, "_")
    return filename.strip().rstrip(".")


def resolve_ffmpeg_path(candidate: str) -> str:
    """
    Normalize the provided ffmpeg path:
      - If it's a directory, look for 'ffmpeg' / 'ffmpeg.exe' inside it.
      - If it's an executable file, return it.
      - If it's just 'ffmpeg', attempt to resolve via PATH.
    Exits the process with a helpful message if not valid.
    """
    if os.path.isdir(candidate):
        for name in ("ffmpeg", "ffmpeg.exe"):
            cand = os.path.join(candidate, name)
            if os.path.exists(cand):
                candidate = cand
                break

    if candidate in ("ffmpeg", "ffmpeg.exe"):
        found = shutil.which(candidate)
        if found:
            candidate = found

    if not os.path.exists(candidate):
        print(
            f"FATAL: FFmpeg path does not exist: '{candidate}'",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)
    if not os.access(candidate, os.X_OK):
        print(
            f"FATAL: FFmpeg at '{candidate}' is not executable. Try 'chmod +x {candidate}'.",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)
    return candidate


app = Flask(__name__)
CORS(app)
jobs: Dict[str, Job] = {}
APP_TEMP_DIR = os.path.join(tempfile.gettempdir(), "yt-link")
os.makedirs(APP_TEMP_DIR, exist_ok=True)


# --- Startup Cleanup ---
def cleanup_old_job_dirs() -> None:
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


# --- Progress Hook (defined early so static analyzers see it) ---
def progress_hook(d: Dict[str, Any]) -> None:
    """
    yt-dlp progress hook. Expects 'info_dict' to contain 'job_id' which we
    attach before download. Updates the Job object in `jobs`.
    """
    info_dict = d.get("info_dict", {})
    job_id = info_dict.get("job_id")
    if not job_id or job_id not in jobs:
        return
    job = jobs[job_id]

    status = d.get("status")
    if status == "downloading":
        job.status = "downloading"
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if total:
            downloaded = d.get("downloaded_bytes", 0)
            try:
                job.progress = float(downloaded) / float(total) * 100.0
            except Exception:
                job.progress = None
        job.message = f"Downloading: {d.get('_percent_str', 'N/A')} at {d.get('_speed_str', 'N/A')}"
    elif status == "finished":
        job.status = "processing"
        job.message = "Download finished, converting..."


# --- Flask Routes ---


@app.route("/get-formats", methods=["POST"])
def get_formats_endpoint() -> Response:
    data = request.get_json()
    if not data or "url" not in data:
        return jsonify({"error": "Invalid request, URL is required."}), 400
    url = data["url"]
    try:
        ydl_opts: Dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "nocheckcertificate": True,
        }
        # cast to Any so stubs for yt_dlp don't cause arg-type errors
        with yt_dlp.YoutubeDL(cast(Any, ydl_opts)) as ydl:
            info = ydl.extract_info(url, download=False) or {}
            unique_formats: Dict[int, Dict[str, Any]] = {}
            # formats can be None or list; cast to list for static analysis purposes
            all_formats = cast(List[Dict[str, Any]], info.get("formats", []) or [])

            def get_height(f: Dict[str, Any]) -> int:
                return int(f.get("height") or 0)

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
    except DownloadError:
        return jsonify({"error": "Video not found or unavailable."}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/start-job", methods=["POST"])
def start_job_endpoint() -> Response:
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
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
    }

    if "--packaged-win" in sys.argv:
        ydl_opts["noprogress"] = True

    if job_type == "singleVideo":
        quality = data.get("quality", "best")
        format_string = (
            f"bestvideo[ext=mp4][height<={quality}]+bestaudio[ext=m4a]/best[ext=mp4][height<={quality}]/best"
            if quality != "best"
            else "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        )
        ydl_opts.update(
            {
                "format": format_string,
                "outtmpl": output_template,
                "noplaylist": True,
                "merge_output_format": "mp4",  # force mp4 container
                "postprocessors": [
                    {
                        "key": "FFmpegVideoConvertor",
                        "preferedformat": "mp4",  # cross-platform safe
                    }
                ],
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
def get_job_status() -> Response:
    job_id = request.args.get("jobId")
    if not job_id or job_id not in jobs:
        return jsonify({"status": "not_found"}), 404
    return jsonify(jobs[job_id].__dict__)


@app.route("/download/<job_id>", methods=["GET"])
def download_file_route(job_id: str) -> Response:
    job = jobs.get(job_id)
    if (
        not job
        or job.status != "completed"
        or not job.file_path
        or not os.path.exists(job.file_path)
    ):
        return jsonify({"error": "Job not found, not ready, or file is missing."}), 404

    def file_generator(
        file_path: str, temp_dir: Optional[str]
    ) -> Generator[bytes, None, None]:
        try:
            with open(file_path, "rb") as f:
                # stream in chunks to avoid loading full file into memory
                while True:
                    chunk = f.read(8192)
                    if not chunk:
                        break
                    yield chunk
        finally:
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
            jobs.pop(job_id, None)
            print(f"Cleaned up job and temp files for job_id: {job_id}")

    # Ensure we pass a str into quote and handle None filenames
    encoded_file_name = quote(str(job.file_name or ""))
    fallback_file_name = (
        (job.file_name or "download.dat")
        .encode("ascii", "ignore")
        .decode("ascii")
        .replace('"', "")
    )
    headers = {
        "Content-Disposition": f'attachment; filename="{fallback_file_name}"; filename*="UTF-8\'\'{encoded_file_name}"'
    }
    return Response(
        file_generator(job.file_path, job.temp_dir),
        mimetype="application/octet-stream",
        headers=headers,
    )


def download_thread(
    url: str, ydl_opts: Dict[str, Any], job_id: str, job_type: str
) -> None:
    job = jobs[job_id]
    job.temp_dir = os.path.join(APP_TEMP_DIR, job_id)
    os.makedirs(job.temp_dir, exist_ok=True)
    try:
        # cast to Any to avoid strict type checks against yt_dlp's internal typings
        with yt_dlp.YoutubeDL(cast(Any, ydl_opts)) as ydl:
            info_dict = ydl.extract_info(url, download=False)
            if not info_dict:
                raise DownloadError("Failed to extract video information.")

            # Attach job_id to each entry so the progress hook can access it
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


def finalize_job(job_id: str, job_type: str) -> None:
    job = jobs[job_id]
    assert job.temp_dir and job.info is not None, "Job temp_dir or info is not set"

    if job_type == "singleVideo":
        # Accept a few common container extensions
        video_extensions = [".mp4", ".mkv", ".webm", ".mov", ".avi"]
        found_files = [
            f
            for f in os.listdir(job.temp_dir)
            if os.path.splitext(f)[1].lower() in video_extensions
        ]
        if not found_files:
            job.status = "failed"
            job.error = "No final video file found after download."
            return
        # prefer mp4 if available
        found_files = sorted(
            found_files, key=lambda x: (0 if x.lower().endswith(".mp4") else 1, x)
        )
        job.file_name = found_files[0]
        job.file_path = os.path.join(job.temp_dir, job.file_name)
    else:
        mp3_files = sorted(
            [
                os.path.join(job.temp_dir, f)
                for f in os.listdir(job.temp_dir)
                if f.lower().endswith(".mp3")
            ]
        )
        if not mp3_files:
            job.status = "failed"
            job.error = "No MP3 files found after conversion."
            return

        playlist_title = sanitize_filename(
            str(job.info.get("title", "playlist"))
            if isinstance(job.info, dict)
            else "playlist"
        )

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
                    # Escape single quotes for ffmpeg concat usage
                    escaped = mp3_file.replace("'", "'\\''")
                    f.write(f"file '{escaped}'\n")

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
            process = subprocess.run(command, capture_output=True, text=True)
            if process.returncode != 0:
                raise Exception(f"FFMPEG Concat Error: {process.stderr}")

    job.status, job.message = "completed", "Processing complete!"


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("FATAL: Missing port and FFmpeg path.", file=sys.stderr, flush=True)
        sys.exit(1)

    port_arg, ffmpeg_path_arg = sys.argv[1], sys.argv[2]

    ffmpeg_exe = resolve_ffmpeg_path(ffmpeg_path_arg)
    port = int(port_arg)

    print(f"--- Backend starting on port {port} ---", flush=True)
    print(f"--- Using FFmpeg from: {ffmpeg_exe} ---", flush=True)
    print(f"Flask-Backend-Ready:{port}", flush=True)
    app.run(host="127.0.0.1", port=port, debug=False)
