# service/app.py
import codecs
import os
os.environ["PYTHONUTF8"] = "1"
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
import re
import io
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
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
node_exe: Optional[str] = None


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POTENTIAL_BIN = os.path.join(BASE_DIR, "bin", "ffmpeg.exe" if os.name == "nt" else "ffmpeg")
if os.path.exists(POTENTIAL_BIN):
    ffmpeg_exe = POTENTIAL_BIN
# --- Job Queue, Lock, and Retry Settings ---
jobs: Dict[str, "Job"] = {}
jobs_lock = threading.Lock()
job_queue: queue.Queue["Job"] = queue.Queue()
MAX_RETRIES = 5
RETRY_DELAY = 300  # 5 minutes


class SafeLogger:
    def debug(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
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
            if self.status in ["completed", "failed"]:
                if status not in ["processing", "queued", "downloading"]:
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
        output_template = os.path.join(self.temp_dir, "%(title)s.%(ext)s")
        if self.job_type in ["playlistZip", "combineMp3"]:
            output_template = os.path.join(
                self.temp_dir, "%(playlist_index)03d-%(title).100s.%(ext)s"
            )

        ydl_opts: Dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "verbose": False,
            "cachedir": False,
            "check_formats": False,
            "javascript_runtimes": ['deno','node'],
            "noprogress": True,
            "logger": SafeLogger(),
            "progress_hooks": [self._progress_hook],
            "nocheckcertificate": True,
            "ffmpeg_location": ffmpeg_exe,
            "prefer_ffmpeg": True,
            "youtube_include_dash_manifest": True,
            "youtube_include_hls_manifest": True,
            "sleep_interval": 3,  # Added to help with rate limits
            "max_sleep_interval": 10,
            "socket_timeout": 30,
            "retries": 3,
            "fragment_retries": 3,
            "download_archive": os.path.join(self.temp_dir, "downloaded.txt"),
        }

        if self.job_type == "singleVideo":
            selected_format = self.data.get("format") or self.data.get("quality")

            if selected_format:
                quality = f"{selected_format}+bestaudio/best"
            else:
                quality = (
                    "bestaudio/best"
                )

            ydl_opts.update(
                {
                    "format": quality,
                    "outtmpl": output_template,
                    "restrictfilenames": True,
                    "noplaylist": True,
                    "merge_output_format": "mp4",
                }
            )
        else:  # Audio jobs
            ydl_opts.update(
                {
                    "format": "bestaudio/best",
                    "outtmpl": output_template,
                    "noplaylist": self.job_type == "singleMp3",
                    "ignoreerrors": True,
                    "restrictfilenames": True,
                    "ffmpeg_location": ffmpeg_exe,
                    "postprocessors": [
                        {
                            "key": "FFmpegExtractAudio",
                            "preferredcodec": "mp3",
                            "preferredquality": "192",
                        }
                    ],
                    "postprocessor_args": [],
                    "keepvideo": False,
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
        pause_timeout = 0
        while self.status == "paused":
            if pause_timeout > 3600:
                self.set_status("failed", "Job timed out while paused.")
                return
            self.set_status("paused", "Job is paused. Waiting for resume...")
            time.sleep(2)
            pause_timeout += 2

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

    def _finalize(self) -> None:
        # Update status to indicate finalization has started
        self.set_status("processing", "Finalizing files...", self.progress or 100)
        time.sleep(2)
        
        # Ensure critical job data is present before proceeding
        if not self.temp_dir or self.info is None:
            self.set_status("failed", "Finalization failed: Missing metadata.")
            return

        # Logic for processing a single video download
        if self.job_type == "singleVideo":
            # Define acceptable video formats
            video_extensions = [".mp4", ".mkv", ".webm", ".mov", ".avi"]
            # Scan directory for completed video files, excluding active partial downloads
            found_files = [
                f
                for f in os.listdir(self.temp_dir)
                if os.path.splitext(f)[1].lower() in video_extensions
                and not f.endswith(".part")
            ]
            
            if not found_files:
                raise Exception("No final video file found after download.")
            
            # Identify the raw downloaded file and prepare the sanitized destination name
            original_filename = found_files[0]
            original_filepath = os.path.join(self.temp_dir, original_filename)
            video_title = self.info.get("title", "video")

            self.file_name = sanitize_filename(f"{video_title}.mp4")
            self.file_path = os.path.join(self.temp_dir, self.file_name)

            def safe_print(msg):
                try:
                    print(msg, flush=True)
                except UnicodeEncodeError:
                    print(msg.encode('ascii', 'ignore').decode('ascii'), flush=True)

            # Rename the file to the clean, sanitized title if necessary
            if original_filepath != self.file_path:
                try:
                    os.rename(original_filepath, self.file_path)
                    safe_print(f"Renamed '{original_filename}' to '{self.file_name}'")
                except OSError as e:
                    safe_print(f"Warning: Could not rename file. Error: {e}")
                    self.file_name = sanitize_filename(original_filename)
                    self.file_path = original_filepath
            else:
                self.file_name = sanitize_filename(original_filename)
        
        # Logic for processing audio-based jobs (Single MP3, ZIP, or Combined)
        else:
            time.sleep(1)
            all_files = os.listdir(self.temp_dir)
            print(f"DEBUG: Files in temp_dir: {all_files}", flush=True)

            # Look for common audio formats to ensure we don't miss files that failed MP3 conversion
            audio_extensions = (".mp3", ".m4a", ".webm")
            audio_files = sorted(
                [
                    os.path.join(self.temp_dir, f)
                    for f in all_files
                    if f.lower().endswith(audio_extensions)
                    and not f.endswith("(Combined).mp3")
                    and not f.endswith(".zip")
                ]
            )

            if not audio_files:
                self.set_status("error", f"No audio tracks found. Found: {all_files}")
                return

            playlist_title = sanitize_filename(
                str(self.info.get("title", "playlist"))
                if isinstance(self.info, dict)
                else "playlist"
            )

            # Handle single track audio download
            if self.job_type == "singleMp3":
                original_filepath = audio_files[0]
                track_title = self.info.get("title", "track")
                self.file_name = sanitize_filename(f"{track_title}.mp3")
                self.file_path = os.path.join(self.temp_dir, self.file_name)

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
                        self.file_name = sanitize_filename(
                            os.path.basename(original_filepath)
                        )
                        self.file_path = original_filepath
                else:
                    self.file_name = sanitize_filename(
                        os.path.basename(original_filepath)
                    )
            
            # Handle creating a ZIP archive of all playlist tracks
            elif self.job_type == "playlistZip":
                self.set_status("processing", "Creating ZIP archive...", self.progress)
                time.sleep(1.5)
                self.file_name = f"{playlist_title}.zip"
                self.file_path = os.path.join(self.temp_dir, self.file_name)

                with zipfile.ZipFile(self.file_path, "w") as zipf:
                    for audio_file in audio_files:
                        zipf.write(audio_file, os.path.basename(audio_file))

            # Handle combining all playlist tracks into a single MP3 file
            elif self.job_type == "combineMp3":
                self.set_status("processing", "Combining all tracks...", self.progress)
                self.file_name = f"{playlist_title} (Combined).mp3"
                self.file_path = os.path.join(self.temp_dir, self.file_name)
                concat_list_path = os.path.join(self.temp_dir, "concat_list.txt")
                
                # Create a temporary manifest file for FFmpeg concatenation
                with open(concat_list_path, "w", encoding="utf-8") as f:
                    for audio_file in audio_files:
                        # Escape single quotes in filenames for FFmpeg compatibility
                        escaped = audio_file.replace("'", "'\\''")
                        f.write(f"file '{escaped}'\n")

                # Execute FFmpeg to merge tracks; uses re-encoding to ensure consistent MP3 output
                command = [
                    ffmpeg_exe,
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    concat_list_path,
                    "-c:a",
                    "libmp3lame",
                    "-q:a",
                    "2",
                    "-y",
                    self.file_path,
                ]
                env = os.environ.copy()
                env["PYTHONIOENCODING"] = "1"

                process = subprocess.run(
                    command, capture_output=True, text=True, encoding="utf-8", env=env
                )
                
                if process.returncode != 0:
                    raise Exception(f"FFMPEG Concat Error: {process.stderr}")

        # Mark job as fully successful
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


def sanitize_url_for_job(url: str, job_type: str) -> str:
    # If the user wants a single file, remove playlist data to prevent loops
    if job_type in ["singleVideo", "singleMp3"]:
        if "v=" in url:
            # Extract just the video ID: watch?v=XXXXXXXX
            match = re.search(r"(v=[a-zA-Z0-9_-]+)", url)
            if match:
                return f"https://www.youtube.com/watch?{match.group(1)}"
    return url
# --- (resolve_ffmpeg_path - unchanged) ---
def resolve_ffmpeg_path(candidate: str) -> str:
    if os.path.isdir(candidate):
        for name in ("ffmpeg", "ffmpeg.exe"):
            cand = os.path.join(candidate, name)
            if os.path.exists(cand):
                candidate = cand
                break
    
    ffmpeg_exe = os.path.abspath(candidate)
    ffmpeg_dir = os.path.dirname(ffmpeg_exe)
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
        try:
            print(f"--- Attempting to fix permissions for: {candidate} ---", flush=True)
            os.chmod(candidate, 0o755)
        except Exception as e:
            print(f"Warning: Could not set executable bit: {e}", file=sys.stderr)

    ffmpeg_dir = os.path.abspath(os.path.dirname(candidate))
    if ffmpeg_dir not in os.environ["PATH"]:
        os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ["PATH"]
        print(f"--- Added to PATH: {ffmpeg_dir} ---", flush=True)
    global node_exe
    node_path = shutil.which("node") or shutil.which("node.exe")
    if not node_path:
        possible_node = [
            os.path.join(BASE_DIR, "node_modules", ".bin", "node.exe"),
            sys.executable.replace("python.exe", "node.exe")
        ]
        for p in possible_node:
            if os.path.exists(p):
                node_path = p
                break

    if node_path:
        node_exe = os.path.abspath(node_path)
        node_dir = os.path.dirname(node_exe)
        if node_dir not in os.environ["PATH"]:
            os.environ["PATH"] = node_dir + os.pathsep + os.environ["PATH"]
            print(f"--- Node injected from: {node_dir} ---", flush=True)

    if ffmpeg_dir not in os.environ["PATH"]:
        os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ["PATH"]
    print(f"--- Environment Ready: FFmpeg and Node Path verified ---", flush=True)

    if not os.access(candidate, os.X_OK):
        try:
            os.chmod(candidate, 0o755)
        except:
            pass
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
            "verbose": True,
            "quiet": True,
            "no_warnings": True,
            "restrictfilenames": True,
            "format": "all",
            "extract_flat": False,
            "javascript_runtimes": ['deno','node'],
            "check_formats": False,
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
            try:
                with yt_dlp.YoutubeDL(cast(Any, ydl_opts)) as ydl:
                    print(
                        "--- [get-formats] Calling yt-dlp.extract_info...", flush=True
                    )
                    # Use a small timeout to prevent hanging on Windows
                    info = ydl.extract_info(url, download=False) or {}
                    print(
                        "--- [get-formats] yt-dlp.extract_info finished successfully.",
                        flush=True,
                    )
            except Exception as e:
                print(f"\n[CRITICAL BACKEND ERROR]: {str(e)}", flush=True)
                import traceback

                traceback.print_exc()
                return jsonify({"error": str(e)}), 500

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
        job_type = data["jobType"]
        if not data or "url" not in data or "jobType" not in data:
            return jsonify({"error": "Invalid request body"}), 400

        raw_url = data.get("url", "")
        data["url"] = sanitize_url_for_job(raw_url, job_type)

        job_id = str(uuid.uuid4())
        job = Job(job_id=job_id, job_type=job_type, data=data)

        with jobs_lock:
            jobs[job_id] = job
        job_queue.put(job)

        print(f"Job enqueued: {job_id} ({job_type})")
        return jsonify({"jobId": job_id})

    # --- This block will now catch any errors ---
    except Exception as e:
        print(f"CRITICAL ERROR in queue_worker: {str(e)}")
        if job:
            job.set_status(
                "failed",
                f"Finalization failed: {str(e)}",
                error=traceback.format_exc(),
            )
        time.sleep(2)
        
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
    headers = {
        "Content-Disposition": f'attachment; filename="{quote(final_name)}"',
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
        job = job_queue.get()
        try:
            job.run()
        except Exception as e:
            job.set_status(
                "failed",
                message=f"Processing error: {str(e)}",
                error =traceback.format_exc()
            )
            print(f"[WORKER CRASH]:{str(e)}")
        finally:
            job_queue.task_done()
            time.sleep(1)


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
