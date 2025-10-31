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
import queue
from typing import (
    Any,
    Dict,
    Generator,
    List,
    Optional,
    cast,
    Union,
)  # --- MODIFIED: Added Union ---

from flask import Flask, Response, request, jsonify
from flask_cors import CORS

import yt_dlp  # type: ignore[import]
from yt_dlp.utils import DownloadError  # type: ignore[import]
from urllib.parse import quote

# This will be set at runtime from the command line arguments
ffmpeg_exe: Optional[str] = None

# --- NEW: Job Queue, Lock, and Retry Settings ---
# --- MODIFIED: Use forward reference "Job" for type hints ---
jobs: Dict[str, "Job"] = {}  # This will store the *state* of the job
jobs_lock = threading.Lock()
job_queue: queue.Queue["Job"] = queue.Queue()  # Specify the queue holds "Job" objects
MAX_RETRIES = 5
RETRY_DELAY = 300  # 5 minutes


class Job:
    # --- MODIFIED: __init__ now takes all job data ---
    def __init__(self, job_id: str, job_type: str, data: Dict[str, Any]) -> None:
        self.job_id: str = job_id
        self.url: str = data.get("url", "")
        self.job_type: str = job_type
        self.data: Dict[str, Any] = data  # Store all request data
        self.status: str = "queued"
        self.message: str = "Job is queued..."
        self.progress: Optional[float] = None
        self.error: Optional[str] = None
        self.temp_dir: str = os.path.join(APP_TEMP_DIR, self.job_id)
        # --- MODIFIED: Be more specific with info type ---
        self.info: Optional[Dict[str, Any]] = None
        self.file_path: Optional[str] = None
        self.file_name: Optional[str] = None

    # --- NEW: Helper to safely update status ---
    def set_status(
        self,
        status: str,
        message: str,
        progress: Optional[float] = None,
        error: Optional[str] = None,
    ) -> None:
        with jobs_lock:
            self.status = status
            self.message = message
            if progress is not None:
                self.progress = progress
            if error:
                self.error = error
                print(
                    f"--- [Job {self.job_id}] ERROR: {self.error}",
                    file=sys.stderr,
                    flush=True,
                )
            # Update the global dict that /job-status reads
            jobs[self.job_id] = self

    # --- NEW: Helper to update progress from the hook ---
    def update_progress(self, d: Dict[str, Any]) -> None:
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            progress_val = None
            if total:
                downloaded = d.get("downloaded_bytes", 0)
                try:
                    progress_val = float(downloaded) / float(total) * 100.0
                except Exception:
                    progress_val = None
            self.set_status(
                "downloading",
                f"Downloading: {d.get('_percent_str', 'N/A')} at {d.get('_speed_str', 'N/A')}",
                progress_val,
            )
        elif status == "finished":
            self.set_status(
                "processing", "Download finished, converting...", self.progress
            )

    # --- NEW: Logic moved from /start-job route ---
    def _build_ydl_opts(self) -> Dict[str, Any]:
        output_template = os.path.join(self.temp_dir, "%(title)s.%(ext)s")
        if self.job_type in ["playlistZip", "combineMp3"]:
            output_template = os.path.join(
                self.temp_dir, "%(playlist_index)03d-%(title)s.%(ext)s"
            )

        ydl_opts: Dict[str, Any] = {
            "progress_hooks": [self._progress_hook],
            "nocheckcertificate": True,
            "quiet": True,
            "no_warnings": True,
            "ffmpeg_location": ffmpeg_exe,
            "retries": 10,
            "fragment_retries": 10,
        }

        if self.job_type == "singleVideo":
            quality = self.data.get("quality", "best")
            format_string = (
                f"bestvideo[ext=mp4][height<={quality}]+bestaudio[ext=m4a]/best[ext=mp4][height<={quality}]"
                if quality != "best"
                else "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]"
            )
            ydl_opts.update(
                {
                    "format": format_string,
                    "outtmpl": output_template,
                    "noplaylist": True,
                    "merge_output_format": "mp4",
                    "postprocessors": [
                        {
                            "key": "FFmpegVideoConvertor",
                            "preferedformat": "mp4",
                        }
                    ],
                }
            )
        else:  # All audio jobs
            ydl_opts.update(
                {
                    "format": "bestaudio/best",
                    "outtmpl": output_template,
                    "noplaylist": self.job_type == "singleMp3",
                    "ignoreerrors": self.job_type != "singleMp3",
                    "postprocessors": [
                        {
                            "key": "FFmpegExtractAudio",
                            "preferredcodec": "mp3",
                            "preferredquality": "192",
                        }
                    ],
                }
            )

        if self.data.get("cookies"):
            cookie_file = os.path.join(APP_TEMP_DIR, f"cookies_{self.job_id}.txt")
            with open(cookie_file, "w", encoding="utf-8") as f:
                f.write(self.data["cookies"])
            ydl_opts["cookiefile"] = cookie_file

        return ydl_opts

    # --- NEW: Progress hook is now a method ---
    def _progress_hook(self, d: Dict[str, Any]) -> None:
        self.update_progress(d)

    # --- NEW: Main execution logic, moved from download_thread ---
    def run(self) -> None:
        self.set_status("processing", "Preparing download...", 0)
        os.makedirs(self.temp_dir, exist_ok=True)
        ydl_opts = self._build_ydl_opts()

        retries = 0
        success = False
        last_error_str = ""

        while retries < MAX_RETRIES and not success:
            try:
                if retries > 0:
                    self.set_status(
                        "processing",
                        f"Retrying download... (Attempt {retries + 1}/{MAX_RETRIES})",
                        0,
                    )

                with yt_dlp.YoutubeDL(cast(Any, ydl_opts)) as ydl:
                    info_dict = ydl.extract_info(self.url, download=False)
                    if not info_dict:
                        raise DownloadError("Failed to extract video information.")

                    self.info = info_dict
                    ydl.download([self.url])

                self._finalize()
                success = True

            except DownloadError as e:
                last_error_str = str(e)
                if "HTTP Error 403: Forbidden" in last_error_str:
                    retries += 1
                    if retries < MAX_RETRIES:
                        self.set_status(
                            "error",
                            f"Blocked (403). Retrying in {RETRY_DELAY // 60} min... ({retries}/{MAX_RETRIES})",
                            self.progress,
                        )
                        time.sleep(RETRY_DELAY)
                    else:
                        self.set_status(
                            "failed",
                            f"Failed after {MAX_RETRIES} attempts due to 403 Forbidden error.",
                            error=last_error_str,
                        )
                else:
                    self.set_status("failed", "Download failed.", error=last_error_str)
                    break
            except Exception:  # --- MODIFIED: Removed 'as e' to fix F841 ---
                self.set_status(
                    "failed",
                    "A processing error occurred.",
                    error=traceback.format_exc(),
                )
                break

        cookie_file = ydl_opts.get("cookiefile")
        if cookie_file and os.path.exists(cookie_file):
            os.remove(cookie_file)

    # --- NEW: Logic moved from finalize_job ---
    def _finalize(self) -> None:
        self.set_status("processing", "Finalizing files...", self.progress or 100)
        assert self.temp_dir and self.info is not None, (
            "Job temp_dir or info is not set"
        )

        if self.job_type == "singleVideo":
            video_extensions = [".mp4", ".mkv", ".webm", ".mov", ".avi"]
            found_files = [
                f
                for f in os.listdir(self.temp_dir)
                if os.path.splitext(f)[1].lower() in video_extensions
            ]
            if not found_files:
                raise Exception("No final video file found after download.")
            found_files = sorted(
                found_files, key=lambda x: (0 if x.lower().endswith(".mp4") else 1, x)
            )
            self.file_name = found_files[0]
            self.file_path = os.path.join(self.temp_dir, self.file_name)
        else:
            mp3_files = sorted(
                [
                    os.path.join(self.temp_dir, f)
                    for f in os.listdir(self.temp_dir)
                    if f.lower().endswith(".mp3")
                ]
            )
            if not mp3_files:
                raise Exception("No MP3 files found after conversion.")

            playlist_title = sanitize_filename(
                # --- MODIFIED: Added check for self.info being a dict ---
                str(self.info.get("title", "playlist"))
                if isinstance(self.info, dict)
                else "playlist"
            )

            if self.job_type == "singleMp3":
                self.file_name = os.path.basename(mp3_files[0])
                self.file_path = mp3_files[0]
            elif self.job_type == "playlistZip":
                self.set_status("processing", "Creating ZIP archive...", self.progress)
                self.file_name = f"{playlist_title}.zip"
                self.file_path = os.path.join(self.temp_dir, self.file_name)
                with zipfile.ZipFile(self.file_path, "w") as zipf:
                    for mp3_file in mp3_files:
                        zipf.write(mp3_file, os.path.basename(mp3_file))
            elif self.job_type == "combineMp3":
                self.set_status("processing", "Combining all tracks...", self.progress)
                self.file_name = f"{playlist_title} (Combined).mp3"
                self.file_path = os.path.join(self.temp_dir, self.file_name)
                concat_list_path = os.path.join(self.temp_dir, "concat_list.txt")
                with open(concat_list_path, "w", encoding="utf-8") as f:
                    for mp3_file in mp3_files:
                        escaped = mp3_file.replace("'", "'\\''")
                        f.write(f"file '{escaped}'\n")

                command = [
                    str(ffmpeg_exe),
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    concat_list_path,
                    "-c",
                    "copy",
                    "-y",
                    self.file_path,
                ]
                process = subprocess.run(
                    command, capture_output=True, text=True, encoding="utf-8"
                )
                if process.returncode != 0:
                    raise Exception(f"FFMPEG Concat Error: {process.stderr}")

        self.set_status("completed", "Processing complete!", 100)

    # --- NEW: Helper for /job-status endpoint ---
    def to_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "url": self.url,
            "job_type": self.job_type,
            "status": self.status,
            "message": self.message,
            "progress": self.progress,
            "error": self.error,
            "file_name": self.file_name,
        }


# --- (UTF-8 Fix - unchanged) ---
if sys.stdout.encoding != "utf-8":
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "strict")  # type: ignore[arg-type]
if sys.stderr.encoding != "utf-8":
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "strict")  # type: ignore[arg-type]


# --- (sanitize_filename - unchanged) ---
def sanitize_filename(filename: str) -> str:
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        filename = filename.replace(char, "_")
    return filename.strip().rstrip(".")


# --- (resolve_ffmpeg_path - unchanged) ---
def resolve_ffmpeg_path(candidate: str) -> str:
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


# --- (App setup - unchanged) ---
app = Flask(__name__)
CORS(app)
APP_TEMP_DIR = os.path.join(tempfile.gettempdir(), "yt-link")
os.makedirs(APP_TEMP_DIR, exist_ok=True)


# --- (cleanup_old_job_dirs - unchanged) ---
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


# --- Flask Routes ---


# --- MODIFIED: Added more specific return type hint ---
@app.route("/get-formats", methods=["POST"])
def get_formats_endpoint() -> Union[Response, tuple[Response, int]]:
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
        with yt_dlp.YoutubeDL(cast(Any, ydl_opts)) as ydl:
            info = ydl.extract_info(url, download=False) or {}
            unique_formats: Dict[int, Dict[str, Any]] = {}
            # --- MODIFIED: Removed unnecessary cast ---
            all_formats: List[Dict[str, Any]] = info.get("formats", []) or []

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


# --- MODIFIED: Added more specific return type hint ---
@app.route("/start-job", methods=["POST"])
def start_job_endpoint() -> Union[Response, tuple[Response, int]]:
    data = request.get_json()
    if not data or "url" not in data or "jobType" not in data:
        return jsonify({"error": "Invalid request body"}), 400

    job_id = str(uuid.uuid4())
    job_type = data["jobType"]

    job = Job(job_id=job_id, job_type=job_type, data=data)

    with jobs_lock:
        jobs[job_id] = job
    job_queue.put(job)

    print(f"Job enqueued: {job_id} ({job_type})")
    return jsonify({"jobId": job_id})


# --- MODIFIED: Added more specific return type hint ---
@app.route("/job-status", methods=["GET"])
def get_job_status() -> Union[Response, tuple[Response, int]]:
    job_id = request.args.get("jobId")
    if not job_id:
        return jsonify({"status": "not_found", "error": "Missing jobId"}), 400

    with jobs_lock:
        job = jobs.get(job_id)

    if not job:
        return jsonify({"status": "not_found"}), 404

    return jsonify(job.to_dict())


# --- MODIFIED: Added more specific return type hint ---
@app.route("/download/<job_id>", methods=["GET"])
def download_file_route(job_id: str) -> Union[Response, tuple[Response, int]]:
    with jobs_lock:
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
                while True:
                    chunk = f.read(8192)
                    if not chunk:
                        break
                    yield chunk
        finally:
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
            with jobs_lock:
                jobs.pop(job_id, None)
            print(f"Cleaned up job and temp files for job_id: {job_id}")

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


# --- NEW: Queue Worker Thread ---
def queue_worker() -> None:
    while True:
        job = None
        try:
            job = job_queue.get()
            if job is None:
                continue

            print(f"Worker thread picked up job: {job.job_id} ({job.job_type})")
            job.run()
            print(f"Worker thread finished job: {job.job_id}")

            job_queue.task_done()

        except Exception as e:
            print(f"CRITICAL ERROR in queue_worker: {str(e)}")
            if job:
                job.set_status(
                    "failed",
                    f"Critical worker error: {str(e)}",
                    error=traceback.format_exc(),
                )
            job_queue.task_done()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("FATAL: Missing port and FFmpeg path.", file=sys.stderr, flush=True)
        sys.exit(1)

    port_arg, ffmpeg_path_arg = sys.argv[1], sys.argv[2]

    ffmpeg_exe = resolve_ffmpeg_path(ffmpeg_path_arg)
    port = int(port_arg)

    worker_thread = threading.Thread(target=queue_worker, daemon=True)
    worker_thread.start()

    print(f"--- Backend starting on port {port} ---", flush=True)
    print(f"--- Using FFmpeg from: {ffmpeg_exe} ---", flush=True)
    print("--- Worker thread started ---", flush=True)
    # --- MODIFIED: Fixed f-string and ignored Pylance bug ---
    print(f"Flask-Backend-Ready:{port}", flush=True)  # type: ignore[reportArgumentType]
    app.run(host="127.0.0.1", port=port, debug=False)
