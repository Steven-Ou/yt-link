// /app/api/convert/route.js

// Uses bundled yt-dlp binary copied to /tmp. Uses spawn for yt-dlp and ffmpeg.
// Uses playlist title for output filename.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { spawn } from 'child_process'; // Use spawn for both
import fs from 'fs';
import path from 'path';
import os from 'os';
// No youtube-dl/yt-dlp library imports needed

// --- Setup: Locate bundled binary, copy to /tmp, ensure permissions ---
let confirmedExecutablePath = null; // Path to the executable copy in /tmp
const bundledBinaryName = 'yt-dlp'; // Name of the file in ./bin
const tmpBinaryPath = path.join(os.tmpdir(), `yt-dlp_${Date.now()}`); // Unique path in /tmp

console.log("--- Starting bundled yt-dlp binary setup ---");
try {
    const originalBinaryPath = path.join(process.cwd(), 'bin', bundledBinaryName);
    console.log(`Attempting to locate bundled binary at: ${originalBinaryPath}`);
    if (!fs.existsSync(originalBinaryPath)) {
        try {
             console.error(`Contents of ${process.cwd()}:`, fs.readdirSync(process.cwd()));
             const binDir = path.join(process.cwd(), 'bin');
             if (fs.existsSync(binDir)) { console.error(`Contents of ${binDir}:`, fs.readdirSync(binDir)); }
         } catch (e) { console.error("Could not list directories for debugging."); }
        throw new Error(`Bundled binary not found at expected path: ${originalBinaryPath}. Ensure bin/yt-dlp is included in deployment.`);
    }
    console.log(`Bundled binary found at: ${originalBinaryPath}`);
    console.log(`Copying binary to: ${tmpBinaryPath}`);
    fs.copyFileSync(originalBinaryPath, tmpBinaryPath);
    console.log(`Binary copied successfully.`);
    console.log(`Attempting chmod +x on the copy: ${tmpBinaryPath}`);
    fs.chmodSync(tmpBinaryPath, 0o755);
    fs.accessSync(tmpBinaryPath, fs.constants.X_OK);
    console.log(`Execute permission confirmed for copy at: ${tmpBinaryPath}`);
    confirmedExecutablePath = tmpBinaryPath;
    console.log("--- Bundled yt-dlp binary setup successful ---");
} catch (err) {
    console.error(`CRITICAL Error setting up bundled yt-dlp binary in /tmp: ${err.message}`);
    console.log("--- Bundled yt-dlp binary setup FAILED ---");
}
// --- End setup ---


// Helper function to sort files
const sortFilesByPlaylistIndex = (a, b) => { /* ... same as before ... */
    const regex = /^(\d+)\./;
    const matchA = a.match(regex);
    const matchB = b.match(regex);
    const indexA = matchA ? parseInt(matchA[1], 10) : Infinity;
    const indexB = matchB ? parseInt(matchB[1], 10) : Infinity;
    return indexA - indexB;
};

// Helper function to sanitize filenames
function sanitizeFilename(name) { /* ... same as before ... */
    return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'untitled';
}

export async function POST(request) {
    console.log('--- COMBINE PLAYLIST MP3 (Bundled Binary) API ROUTE HIT ---');

    // Check if binary setup succeeded
    if (!confirmedExecutablePath) {
        console.error("Bundled yt-dlp binary could not be prepared in /tmp.");
        return NextResponse.json({ error: "Server configuration error: yt-dlp setup failed." }, { status: 500 });
    }

    const baseTempDir = os.tmpdir();
    const uniqueFolderName = `playlist_dl_${Date.now()}`;
    const folderPath = path.join(baseTempDir, uniqueFolderName);

    let ffmpegListPath = null;
    let finalMp3Path = null;
    let playlistTitle = 'combined_playlist';

    try {
        const { playlistUrl } = await request.json();
        if (!playlistUrl) {
            return NextResponse.json({ error: 'No playlist URL provided' }, { status: 400 });
        }
        console.log(`Received playlist URL: ${playlistUrl}`);

        // --- 0. Get Playlist Title (using spawn with bundled binary) ---
        try {
            console.log(`Fetching playlist title for: ${playlistUrl}`);
            const titleArgs = [
                playlistUrl,
                '--flat-playlist',
                '--dump-single-json'
            ];
            console.log('yt-dlp spawn args (for title):', titleArgs);

            const { stdout: titleJson, stderr: titleStderr } = await new Promise((resolve, reject) => {
                 const process = spawn(confirmedExecutablePath, titleArgs, { shell: false });
                 let stdoutData = '';
                 let stderrData = '';
                 process.stdout.on('data', (data) => stdoutData += data.toString());
                 process.stderr.on('data', (data) => stderrData += data.toString());
                 process.on('error', (err) => reject(new Error(`Failed to start yt-dlp for title: ${err.message}`)));
                 process.on('close', (code) => {
                     if (stderrData) console.error('yt-dlp stderr (title fetch):\n', stderrData);
                     if (code === 0) { resolve({ stdout: stdoutData, stderr: stderrData }); }
                     else { reject(new Error(`yt-dlp title fetch failed with code ${code}. Stderr: ${stderrData.substring(0, 500)}...`)); }
                 });
             });

            const playlistInfo = JSON.parse(titleJson);
            if (playlistInfo && playlistInfo.title) {
                playlistTitle = sanitizeFilename(playlistInfo.title);
                console.log(`Using sanitized playlist title: ${playlistTitle}`);
            } else { console.warn("Could not extract playlist title, using default."); }
        } catch (titleError) {
            console.error(`Failed to fetch or parse playlist title: ${titleError.message}. Using default name.`);
            // Keep default title
        }

        // Define final output path
        finalMp3Path = path.join(baseTempDir, `${playlistTitle}.mp3`);
        console.log(`Final combined MP3 path set to: ${finalMp3Path}`);

        // --- 1. Download Individual MP3s (using spawn with bundled binary) ---
        console.log(`Attempting to create download directory: ${folderPath}`);
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`Download directory created: ${folderPath}`);
        console.log(`Spawning yt-dlp process to download items into: ${folderPath}`);
        const outputPathTemplate = path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s');
        const downloadArgs = [ playlistUrl, '-x', '--audio-format', 'mp3', '-o', outputPathTemplate ];
        console.log('yt-dlp spawn args (for download):', downloadArgs);

        await new Promise((resolve, reject) => {
            const ytDlpProcess = spawn(confirmedExecutablePath, downloadArgs, { shell: false });
            let stderrData = '';
            ytDlpProcess.stderr.on('data', (data) => { console.error(`yt-dlp stderr (download): ${data}`); stderrData += data.toString(); });
            ytDlpProcess.on('error', (err) => reject(new Error(`Failed to start yt-dlp download: ${err.message}`)));
            ytDlpProcess.on('close', (code) => {
                console.log(`yt-dlp download process exited with code ${code}`);
                if (code === 0) { resolve(); }
                else { reject(new Error(`yt-dlp download failed with code ${code}. Stderr snippet: ${stderrData.substring(0, 500)}...`)); }
            });
        });
        console.log('yt-dlp playlist download finished.');


        // --- 2. List and Sort MP3 Files ---
        // (Logic remains the same)
        let files = fs.readdirSync(folderPath);
        files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
        files.sort(sortFilesByPlaylistIndex);
        if (files.length === 0) { throw new Error(`yt-dlp did not produce any MP3 files.`); }

        // --- 3. Combine if necessary (using spawn for ffmpeg) ---
        // (Logic remains the same)
        let sourceMp3Path = null;
        if (files.length === 1) {
             console.warn("Only one MP3 file found. Skipping concatenation.");
             const singleFilePath = path.join(folderPath, files[0]);
             fs.renameSync(singleFilePath, finalMp3Path);
             console.log(`Renamed single file to: ${finalMp3Path}`);
             sourceMp3Path = finalMp3Path;
        } else {
            console.log(`Found ${files.length} MP3 files for concatenation.`);
            ffmpegListPath = path.join(folderPath, 'mylist.txt');
            const fileListContent = files.map(file => `file '${path.join(folderPath, file).replace(/'/g, "'\\''")}'`).join('\n');
            fs.writeFileSync(ffmpegListPath, fileListContent);
            console.log(`Generated FFmpeg file list: ${ffmpegListPath}`);
            console.log(`Spawning ffmpeg to combine MP3s into: ${finalMp3Path}`);
            const ffmpegArgs = [ '-f', 'concat', '-safe', '0', '-i', ffmpegListPath, '-c', 'copy', finalMp3Path ];
            await new Promise((resolve, reject) => { /* ... ffmpeg spawn logic ... */
                const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { shell: false });
                let ffmpegStderr = '';
                ffmpegProcess.stderr.on('data', (data) => { console.error(`ffmpeg stderr: ${data}`); ffmpegStderr += data; });
                ffmpegProcess.on('error', (err) => reject(new Error(`ffmpeg spawn error: ${err.message}. Is ffmpeg installed/available?`)));
                ffmpegProcess.on('close', (code) => {
                    if (code === 0) { resolve(); }
                    else { reject(new Error(`ffmpeg failed with code ${code}. Stderr: ${ffmpegStderr.substring(0,500)}`)); }
                });
            });
            console.log('FFmpeg MP3 concatenation finished.');
            sourceMp3Path = finalMp3Path;
        }

        // --- 4. Respond with the final MP3 ---
        // (Streaming logic remains the same)
        if (!sourceMp3Path || !fs.existsSync(sourceMp3Path)) {
            throw new Error("Final MP3 file path not found or not generated.");
        }
        const stats = fs.statSync(sourceMp3Path);
        const dataStream = fs.createReadStream(sourceMp3Path);
        const filenameForUser = path.basename(sourceMp3Path);
        console.log(`Streaming final MP3: ${sourceMp3Path}, Size: ${stats.size}`);
        const fallbackFilename = 'combined_playlist.mp3';
        const encodedFilename = encodeURIComponent(filenameForUser);
        const contentDispositionValue = `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`;
        const responseStream = new ReadableStream({ /* ... stream handling ... */
            start(controller) {
                 dataStream.on('data', (chunk) => controller.enqueue(chunk));
                 dataStream.on('end', () => { controller.close(); cleanupTempFiles(folderPath, sourceMp3Path, confirmedExecutablePath); }); // Clean up download dir, final file, AND binary copy
                 dataStream.on('error', (err) => { controller.error(err); cleanupTempFiles(folderPath, sourceMp3Path, confirmedExecutablePath); });
            },
            cancel() {
                dataStream.destroy(); cleanupTempFiles(folderPath, sourceMp3Path, confirmedExecutablePath);
            }
        });
        return new NextResponse(responseStream, {
            status: 200,
            headers: { /* ... headers ... */
                 'Content-Disposition': contentDispositionValue,
                 'Content-Type': 'audio/mpeg',
                 'Content-Length': stats.size.toString(),
             },
        });

    } catch (error) {
        console.error("API /api/convert final catch error:", error);
        let errorMessage = `Playlist MP3 combination failed: ${error.message}`;
        if (error.message.includes('Stderr snippet:')) {
            errorMessage = error.message; // Keep the message with stderr
        }
        cleanupTempFiles(folderPath, finalMp3Path, confirmedExecutablePath); // Clean up download dir, final file, AND binary copy
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}

// Updated cleanup function for folder, final file, and binary copy
function cleanupTempFiles(tempFolderPath, finalFilePath, binaryTmpPath) {
     setTimeout(() => {
        try {
            if (tempFolderPath && fs.existsSync(tempFolderPath)) {
                console.log(`CLEANUP: Removing folder: ${tempFolderPath}`);
                fs.rmSync(tempFolderPath, { recursive: true, force: true });
            }
        } catch (cleanupError) { console.error("CLEANUP (Download Folder) Error:", cleanupError); }
        try {
            if (finalFilePath && finalFilePath !== tempFolderPath && fs.existsSync(finalFilePath)) {
                console.log(`CLEANUP: Removing final file: ${finalFilePath}`);
                fs.unlinkSync(finalFilePath);
            } else if (finalFilePath === tempFolderPath) {
                 console.log(`CLEANUP: Final file path was the same as temp folder path, folder already removed.`);
            }
        } catch (cleanupError) { console.error("CLEANUP (Final File) Error:", cleanupError); }
         try {
             if (binaryTmpPath && fs.existsSync(binaryTmpPath)) {
                 console.log(`CLEANUP: Removing binary copy: ${binaryTmpPath}`);
                 fs.unlinkSync(binaryTmpPath);
             }
         } catch (cleanupError) { console.error("CLEANUP (Binary Copy) Error:", cleanupError); }
    }, 2000);
}
