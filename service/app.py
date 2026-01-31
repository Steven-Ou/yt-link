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
import hashlib
from typing import Any, Dict, Generator, List, Optional, cast, Union

from flask import Flask, Response, request, jsonify
from flask_cors import CORS

import yt_dlp  # type: ignore[import]
from yt_dlp.utils import DownloadError  # type: ignore[import]
from urllib.parse import quote

app = Flask(__name__)
CORS(app)
APP_TEMP_DIR = os.path.join(tempfile.gettempdir(), "yt-link")
os.makedirs(APP_TEMP_DIR, exist_ok=True)
# This will be set at runtime from the command line arguments
ffmpeg_exe: Optional[str] = None

# --- Job Queue, Lock, and Retry Settings ---
jobs: Dict[str, "Job"] = {}
jobs_lock = threading.Lock()
job_queue: queue.Queue["Job"] = queue.Queue()
MAX_RETRIES = 5
RETRY_DELAY = 300  # 5 minutes


class SafeLogger:
    def debug(self, msg: str):
        pass

    def warning(self, msg: str):
        pass

    def error(self, msg: str):
        # Safely handle characters that crash the Windows/Electron pipe
        try:
            clean_msg = str(msg).encode("ascii", "ignore").decode("ascii")
            print(f"[yt-dlp Error]: {clean_msg}", file=sys.stderr, flush=True)
        except:
            pass


class Job:
    def __init__(self, job_id: str, job_type: str, data: Dict[str, Any]) -> None:
        self.job_id: str = job_id
        self.url: str = data.get("url", "")
        self.job_type: str = job_type
        self.data: Dict[str, Any] = data
        self.status: str = "queued"
        self.message: str = "Job is queued..."
        self.progress: Optional[float] = None
        self.error: Optional[str] = None
        self.temp_dir = get_cache_dir(self.url)
        self.info: Optional[Dict[str, Any]] = None
        self.file_path: Optional[str] = None
        self.file_name: Optional[str] = None

    def set_status(
        self,
        status: str,
        message: str,
        progress: Optional[float] = None,
        error: Optional[str] = None,
    ) -> None:
        with jobs_lock:
            if self.status in ["completed", "failed"] and status != self.status:
                return

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
            jobs[self.job_id] = self

    # --- MODIFIED: This method now has the new logging logic ---
    def update_progress(self, d: Dict[str, Any]) -> None:
        if self.status == "paused":
            raise DownloadError("Download paused by user.")

        status = d.get("status")
        if status == "downloading":
            progress_val = None
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                downloaded = d.get("downloaded_bytes", 0)
                try:
                    progress_val = float(downloaded) / float(total) * 100.0
                except Exception:
                    pass  # progress_val remains None

            # --- START NEW LOGGING LOGIC ---
            message = ""
            info = d.get("info_dict")

            if info:
                title = info.get("title", "Unknown title")
                index = info.get("playlist_index")
                count = info.get("playlist_count")

                if index and count:
                    # Playlist: "[1/10] Downloading: Song Title"
                    message = f"[{index}/{count}] Downloading: {title}"
                else:
                    # Single file: "Downloading: Video Title"
                    message = f"Downloading: {title}"

            # Fallback if info_dict wasn't in the hook
            if not message:
                message = f"Downloading: {d.get('_percent_str', 'N/A')} at {d.get('_speed_str', 'N/A')}"
            # --- END NEW LOGGING LOGIC ---

            self.set_status(
                "downloading",
                message,  # Use the new, better message
                progress_val,
            )

        elif status == "finished":
            # --- MODIFIED: More descriptive 'finished' message ---
            info = d.get("info_dict")
            title = info.get("title", "file") if info else "file"
            # Set progress to 100 for this file, but overall job progress might be different
            # We'll use self.progress to keep the *overall* job progress
            self.set_status(
                "processing",
                f"Processing: {title}...",  # e.g., "Processing: Song Title..."
                self.progress,
            )

    # --- END OF MODIFIED METHOD ---

    def _build_ydl_opts(self) -> Dict[str, Any]:
        # 1. RESTORED: Playlist index template for combined/zip jobs
        output_template = os.path.join(self.temp_dir, "%(title).50s.%(ext)s")
        if self.job_type in ["playlistZip", "combineMp3"]:
            output_template = os.path.join(
                self.temp_dir, "%(playlist_index)03d-%(title).50s.%(ext)s"
            )

        ydl_opts: Dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "logger": SafeLogger(),
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "progress_hooks": [self._progress_hook],
            "nocheckcertificate": True,
            "ffmpeg_location": ffmpeg_exe,
            "sleep_interval": 3,  # Added to help with rate limits
            "max_sleep_interval": 10,
            "socket_timeout": 30,
            "retries": 10,
            "fragment_retries": 10,
            "download_archive": os.path.join(self.temp_dir, "downloaded.txt"),
        }

        if self.job_type == "singleVideo":
            selected_format = self.data.get("format") or self.data.get("quality")

            if selected_format:
                quality = f"{selected_format}+bestaudio/best"
            else:
                quality = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"

            ydl_opts.update(
                {
                    "format": quality,
                    "outtmpl": output_template,
                    "noplaylist": True,
                    "merge_output_format": "mp4",
                }
            )
        else:  # Audio jobs
            ydl_opts.update(
                {
                    "format": "bestaudio[ext=m4a]/bestaudio/best",
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

    def _progress_hook(self, d: Dict[str, Any]) -> None:
        self.update_progress(d)

    def run(self) -> None:
        # Initial pause check
        while self.status == "paused":
            self.set_status("paused", "Job is paused. Waiting for resume...")
            time.sleep(1)

        self.set_status("processing", "Preparing download...", 0)

        os.makedirs(self.temp_dir, exist_ok=True)

        existing_mp3s = [
            f
            for f in os.listdir(self.temp_dir)
            if f.lower().endswith(".mp3") and not f.endswith("(Combined).mp3")
        ]

        if existing_mp3s and self.job_type in ["playlistZip", "combineMp3"]:
            try:
                with yt_dlp.YoutubeDL(
                    {"quiet": True, "noprogress": True, "nocheckcertificate": True}
                ) as ydl:
                    self.info = ydl.extract_info(self.url, download=False)

                playlist_count = self.info.get("playlist_count") or len(
                    self.info.get("entries", [])
                )

                if playlist_count > 0 and len(existing_mp3s) >= playlist_count:
                    self.set_status(
                        "processing",
                        "Complete tracks found in cache! Finalizing...",
                        50,
                    )
                    self._finalize()
                    return
                else:
                    print(
                        f"Cache incomplete ({len(existing_mp3s)}/{playlist_count}). Downloading missing tracks..."
                    )
            except Exception as e:
                print(f"Cache validation failed: {e}")

        ydl_opts = self._build_ydl_opts()
        if self.job_type in ["singleMp3", "singleVideo"]:
            if "download_archive" in ydl_opts:
                del ydl_opts["download_archive"]

        retries = 0
        success = False
        last_error_str = ""

        # Main Download Loop with Full Retry Logic
        while retries < MAX_RETRIES and not success:
            while self.status == "paused":
                self.set_status("paused", "Download paused. Waiting for resume...")
                time.sleep(1)

            try:
                if retries > 0:
                    self.set_status(
                        "processing",
                        f"Retrying... (Attempt {retries + 1}/{MAX_RETRIES})",
                        self.progress or 0,
                    )

                with yt_dlp.YoutubeDL(cast(Any, ydl_opts)) as ydl:
                    info_dict = ydl.extract_info(self.url, download=True)
                    if not info_dict:
                        raise DownloadError("Failed to extract video information.")
                    self.info = info_dict

                self._finalize()
                success = True

            except DownloadError as e:
                last_error_str = str(e)
                if "rate-limit" in last_error_str.lower() or "429" in last_error_str:
                    self.set_status(
                        "failed",
                        "Rate limited by YouTube. Wait 1 hour.",
                        error=last_error_str,
                    )
                    return

                if "HTTP Error 403" in last_error_str:
                    retries += 1
                    if retries < MAX_RETRIES:
                        time.sleep(RETRY_DELAY)
                    else:
                        self.set_status(
                            "failed",
                            "Failed after max retries (403 Forbidden).",
                            error=last_error_str,
                        )
                else:
                    self.set_status("failed", "Download failed.", error=last_error_str)
                    break
            except Exception:
                self.set_status(
                    "failed",
                    "A processing error occurred.",
                    error=traceback.format_exc(),
                )
                break

        cookie_file = ydl_opts.get("cookiefile")
        if cookie_file and os.path.exists(cookie_file):
            try:
                os.remove(cookie_file)
            except OSError as e:
                print(f"Warning: could not delete cookie file: {e}")
    def _log(self, message: str, is_error: bool = False):
        """Standardized logging for Windows debugging."""
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        prefix = f"[{timestamp}] [Job {self.job_id}]"
        if is_error:
            print(f"{prefix} ERROR: {message}", file=sys.stderr, flush=True)
        else:
            print(f"{prefix} INFO: {message}", flush=True)
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
                and not f.endswith(".part")
            ]
            if not found_files:
                raise Exception("No final video file found after download.")
            # 1. Get the original downloaded filename (e.g., "().mkv")
            original_filename = found_files[0]
            original_filepath = os.path.join(self.temp_dir, original_filename)

            # 2. Get the title from the info we fetched earlier
            video_title = self.info.get("title", "video")

            # 3. Create a new, sanitized filename ending in .mp4
            self.file_name = sanitize_filename(f"{video_title}.mp4")
            self.file_path = os.path.join(self.temp_dir, self.file_name)

            # 4. Rename the downloaded file to our new, clean name
            if original_filepath != self.file_path:
                try:
                    # Note: os.rename() will fail if the .part file is still being processed
                    # This check assumes the .part file is gone and the final file is present
                    os.rename(original_filepath, self.file_path)
                    print(f"Renamed '{original_filename}' to '{self.file_name}'")
                except OSError as e:
                    print(
                        f"Warning: Could not rename file. Using original path. Error: {e}",
                        file=sys.stderr,
                    )
                    # Fallback: Use the original, ugly name if rename fails
                    self.file_name = sanitize_filename(original_filename)
                    self.file_path = original_filepath
            else:
                # If the name is already correct, just sanitize it
                self.file_name = sanitize_filename(original_filename)
        else:
            time.sleep(1)
            all_files = os.listdir(self.temp_dir)

            mp3_files = sorted(
                [
                    os.path.join(self.temp_dir, f)
                    for f in all_files
                    if f.lower().endswith(".mp3")
                    and not f.endswith(
                        "(Combined).mp3"
                    )  # Ignore result of 'combineMp3'
                ]
            )

            if not mp3_files:
                self.set_status("error", "No individual track MP3s found.")
                return

            playlist_title = sanitize_filename(
                str(self.info.get("title", "playlist"))
                if isinstance(self.info, dict)
                else "playlist"
            )

            if self.job_type == "singleMp3":
                # 1. Get the original downloaded filename (e.g., "().mp3")
                original_filepath = mp3_files[0]

                # 2. Get the title from the info
                track_title = self.info.get("title", "track")

                # 3. Create a new, sanitized filename
                self.file_name = sanitize_filename(f"{track_title}.mp3")
                self.file_path = os.path.join(self.temp_dir, self.file_name)

                # 4. Rename the file
                if original_filepath != self.file_path:
                    try:
                        os.rename(original_filepath, self.file_path)
                        print(
                            f"Renamed '{os.path.basename(original_filepath)}' to '{self.file_name}'"
                        )
                    except OSError as e:
                        print(
                            f"Warning: Could not rename file. Using original path. Error: {e}",
                            file=sys.stderr,
                        )
                        # Fallback
                        self.file_name = sanitize_filename(
                            os.path.basename(original_filepath)
                        )
                        self.file_path = original_filepath
                else:
                    self.file_name = sanitize_filename(
                        os.path.basename(original_filepath)
                    )
            elif self.job_type == "playlistZip":
                self.set_status("processing", "Creating ZIP archive...", self.progress)
                time.sleep(2)
                final_tracks = [
                    os.path.join(self.temp_dir, f)
                    for f in os.listdir(self.temp_dir)
                    if f.lower().endswith(".mp3")
                    and not f.endswith("(Combined).mp3")
                    and not f.endswith(".part")
                ]
                print(f"--- [PlaylistZip] Found {len(final_tracks)} MP3 tracks in {self.temp_dir}")
                
                if not final_tracks:
                    raise Exception(f"No individual track MP3s found in cache directory: {self.temp_dir}")
                
                self.file_name = f"{playlist_title}.zip"
                self.file_path = os.path.join(self.temp_dir, self.file_name)

                with zipfile.ZipFile(self.file_path, "w") as zipf:
                    for mp3_file in final_tracks:
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


def get_cache_dir(url: str) -> str:
    import re

    normalized_url = url
    # 1. If it's a playlist link, keep the list ID but strip indices
    if "list=" in url:
        match = re.search(r"list=([a-zA-Z0-9_-]+)", url)
        if match:
            normalized_url = f"https://www.youtube.com/playlist?list={match.group(1)}"

    # 2. If it's a single video, strip playlist context to treat it as a single file
    elif "v=" in url:
        match = re.search(r"v=([a-zA-Z0-9_-]+)", url)
        if match:
            normalized_url = f"https://www.youtube.com/watch?v={match.group(1)}"

    url_hash = hashlib.md5(normalized_url.encode("utf-8")).hexdigest()
    return os.path.join(APP_TEMP_DIR, f"cache_{url_hash}")


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


@app.route("/get-formats", methods=["POST"])
def get_formats_endpoint() -> Union[Response, tuple[Response, int]]:
    cookie_file = None  # Define here for the 'finally' block

    # --- FIX: The try block now wraps EVERYTHING ---
    try:
        data = request.get_json()  # <--- This line is now safely inside
        if not data or "url" not in data:
            return jsonify({"error": "Invalid request, URL is required."}), 400

        url = data["url"]
        if url.startswith("# Netscape") or len(url) > 1000:
            print("CRITICAL: Received cookie data in the URL field. Rejecting request.")
            return jsonify({"error": "Invalid URL provided."}), 400

        cookies = data.get("cookies")

        print(f"\n--- [get-formats] Received request for URL: {url}", flush=True)
        print(
            f"--- [get-formats] Cookies provided: {'Yes' if cookies else 'No'}",
            flush=True,
        )

        ydl_opts: Dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "nocheckcertificate": True,
            "noplaylist": True,
        }

        if cookies:
            try:
                with tempfile.NamedTemporaryFile(
                    delete=False, mode="w", encoding="utf-8"
                ) as f:
                    f.write(cookies)
                    cookie_file = f.name
                ydl_opts["cookiefile"] = cookie_file
                print(
                    f"--- [get-formats] Using temp cookie file: {cookie_file}",
                    flush=True,
                )
            except Exception as e:
                print(
                    f"[get-formats] ERROR: Failed to create cookie file: {e}",
                    file=sys.stderr,
                    flush=True,
                )
                pass

        with yt_dlp.YoutubeDL(cast(Any, ydl_opts)) as ydl:
            print("--- [get-formats] Calling yt-dlp.extract_info...", flush=True)
            info = ydl.extract_info(url, download=False) or {}
            print("--- [get-formats] yt-dlp.extract_info finished.", flush=True)

        unique_formats: Dict[int, Dict[str, Any]] = {}
        all_formats: List[Dict[str, Any]] = info.get("formats", []) or []

        print(f"--- [get-formats] Found {len(all_formats)} total formats.", flush=True)
        if not all_formats:
            print(
                "--- [get-formats] WARNING: info.get('formats') was empty or missing!",
                flush=True,
            )

        def get_height(f: Dict[str, Any]) -> int:
            return int(f.get("height") or 0)

        all_formats.sort(key=get_height, reverse=True)

        for i, f in enumerate(all_formats):
            height = get_height(f)
            vcodec = f.get("vcodec")
            if i < 15:
                print(
                    f"  > Format {i}: height={height}, vcodec='{vcodec}', acodec='{f.get('acodec')}', ext='{f.get('ext')}'",
                    flush=True,
                )
            if not height or height in unique_formats:
                if i < 15:
                    print(f"    -> SKIPPING (height is 0 or duplicate)", flush=True)
                continue
            if vcodec != "none":
                filesize = f.get("filesize") or f.get("filesize_approx")
                note = f.get("ext", "unknown")
                if filesize:
                    filesize_mb = filesize / (1024 * 1024)
                    note = f"{note} (~{filesize_mb:.1f} MB)"
                note += (
                    " (video+audio)" if f.get("acodec") != "none" else " (video-only)"
                )
                print(f"    -> ADDING format: {height}p, note: {note}", flush=True)
                unique_formats[height] = {
                    "format_id": f.get("format_id"),
                    "ext": f.get("ext"),
                    "resolution": f"{height}p",
                    "height": height,
                    "note": note,
                }
            else:
                if i < 15:
                    print(f"    -> SKIPPING (vcodec is 'none')", flush=True)
                pass
        final_formats = sorted(
            unique_formats.values(), key=lambda x: x["height"], reverse=True
        )
        print(
            f"--- [get-formats] Returning {len(final_formats)} formats to frontend.",
            flush=True,
        )
        return jsonify(final_formats)

    except yt_dlp.utils.DownloadError as e:
        print(f"[get-formats] ERROR: {e}", file=sys.stderr, flush=True)
        return jsonify({"error": "Video not found or unavailable."}), 404
    except Exception as e:
        print(
            f"[get-formats] UNEXPECTED ERROR: {traceback.format_exc()}",
            file=sys.stderr,
            flush=True,
        )
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500
    finally:
        if cookie_file and os.path.exists(cookie_file):
            try:
                os.remove(cookie_file)
                print(f"--- [get-formats] Cleaned up temp cookie file.", flush=True)
            except Exception as e:
                print(
                    f"[get-formats] ERROR: Failed to delete cookie file: {e}",
                    file=sys.stderr,
                    flush=True,
                )


@app.route("/start-job", methods=["POST"])
def start_job_endpoint() -> Union[Response, tuple[Response, int]]:
    # --- FIX: The try block now wraps EVERYTHING ---
    try:
        data = request.get_json()  # <--- This line is now safely inside
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

    # --- This block will now catch any errors ---
    except Exception as e:
        print(
            f"[start-job] UNEXPECTED ERROR: {traceback.format_exc()}",
            file=sys.stderr,
            flush=True,
        )
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500


# --- (get_job_status - unchanged) ---
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
        return jsonify({"error": "Job not found or file is missing."}), 404

    def file_generator(file_path):
        with open(file_path, "rb") as f:
            while True:
                chunk = f.read(8192)
                if not chunk:
                    break
                yield chunk

    # Reverted to simplified headers for better Electron compatibility
    final_name = job.file_name if job.file_name else f"{job_id}.mp3"
    try:
        final_name.encode("latin-1")
        disposition = f'attachment; filename="{final_name}"'
    except UnicodeEncodeError:
        from urllib.parse import quote

        encoded_name = quote(final_name)
        disposition = f"attachment; filename*=UTF-8''{encoded_name}"
    headers = {
        "Content-Disposition": disposition,
        "Content-Type": "application/octet-stream",
        "Content-Length": str(os.path.getsize(job.file_path)),
    }

    return Response(file_generator(job.file_path), headers=headers)


@app.route("/pause-all-jobs", methods=["POST"])
def pause_all_jobs_endpoint() -> Response:
    """
    Sets all 'queued' or 'processing' jobs to a 'paused' state.
    The worker thread will check for this status and wait.
    """
    print("--- API CALL: Pause all jobs ---")
    paused_count = 0
    with jobs_lock:
        for job_id, job in jobs.items():
            if job.status in ["queued", "processing", "downloading", "error"]:
                job.set_status("paused", "All downloads paused by user/network.")
                paused_count += 1

    return jsonify({"message": f"Paused {paused_count} active/queued jobs."})


@app.route("/resume-job/<job_id>", methods=["POST"])
def resume_job_endpoint(job_id: str) -> Union[Response, tuple[Response, int]]:
    """
    Resumes a specific job by setting its status back to 'queued'.
    The worker will pick it up and the Job.run() method will continue.
    """
    print(f"--- API CALL: Resume job {job_id} ---")
    with jobs_lock:
        job = jobs.get(job_id)

    if not job:
        return jsonify({"error": "Job not found"}), 404

    if job.status != "paused":
        return jsonify({"message": "Job is not currently paused."}), 400

    job.set_status("queued", "Job resumed. Waiting for queue...")

    return jsonify({"message": f"Job {job_id} has been re-queued."})


# --- (queue_worker - unchanged) ---
def queue_worker() -> None:
    print("--- Worker thread loop entered ---", flush=True)  # Add this log to verify
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
            try:
                job_queue.task_done()
            except:
                pass


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
    print(f"Flask-Backend-Ready:{port}", flush=True)  # type: ignore[reportArgumentType]
    app.run(host="127.0.0.1", port=port, debug=False)
