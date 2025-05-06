// /app/api/convert/route.js 
// Uses yt-dlp-wrap which downloads the binary to /tmp if needed.
// Keeps spawn for ffmpeg. Uses playlist title for output filename.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { spawn } from 'child_process'; // Keep spawn for ffmpeg
import fs from 'fs';
import path from 'path';
import os from 'os';
// Import the new library
import YTDlpWrap from 'yt-dlp-wrap';

// Instantiate the wrapper - it will manage the binary download/path
const ytDlpWrap = new YTDlpWrap();
// Optional: Log the path it intends to use/download to
// YTDlpWrap.getBinaryPath().then(p => console.log("yt-dlp-wrap binary path:", p));

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
    console.log('--- COMBINE PLAYLIST MP3 (yt-dlp-wrap) API ROUTE HIT ---');

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

        // --- 0. Get Playlist Title (using yt-dlp-wrap) ---
        try {
            console.log(`Fetching playlist title for: ${playlistUrl}`);
            // Define arguments for getting title
            const titleArgs = [
                playlistUrl,
                '--flat-playlist',
                '--dump-single-json'
            ];
            console.log('yt-dlp-wrap args (for title):', titleArgs);
            // Use the exec method of the wrapper instance
            const titleJson = await ytDlpWrap.exec(titleArgs);

            const playlistInfo = JSON.parse(titleJson);
            if (playlistInfo && playlistInfo.title) {
                playlistTitle = sanitizeFilename(playlistInfo.title);
                console.log(`Using sanitized playlist title: ${playlistTitle}`);
            } else {
                 console.warn("Could not extract playlist title from JSON, using default.");
            }
        } catch (titleError) {
            console.error(`Failed to fetch playlist title: ${titleError.message}. Using default name.`);
            // The library might attach stderr to the error object
            if (titleError.stderr) { console.error("Stderr (title fetch):", titleError.stderr); }
        }

        // Define final output path
        finalMp3Path = path.join(baseTempDir, `${playlistTitle}.mp3`);
        console.log(`Final combined MP3 path set to: ${finalMp3Path}`);

        // --- 1. Download Individual MP3s (using yt-dlp-wrap) ---
        console.log(`Attempting to create temporary directory: ${folderPath}`);
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`MP3 download directory created: ${folderPath}`);
        console.log(`Executing yt-dlp-wrap to download items into: ${folderPath}`);
        const outputPathTemplate = path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s');

        // Define download arguments
        const downloadArgs = [
            playlistUrl,
            '-x', // Extract audio
            '--audio-format', 'mp3', // Specify MP3 format
            '-o', outputPathTemplate // Output template
        ];
        console.log('yt-dlp-wrap args (for download):', downloadArgs);

        // Execute download using the wrapper instance
        // We don't necessarily need the stdout here unless debugging
        await ytDlpWrap.exec(downloadArgs);
        console.log('yt-dlp-wrap download execution finished.');


        // --- 2. List and Sort MP3 Files ---
        let files = fs.readdirSync(folderPath);
        files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
        files.sort(sortFilesByPlaylistIndex);
        if (files.length === 0) { throw new Error(`yt-dlp did not produce any MP3 files.`); }

        // --- 3. Combine if necessary (using spawn for ffmpeg) ---
        let sourceMp3Path = null;
        if (files.length === 1) {
             // (Rename logic remains the same)
             console.warn("Only one MP3 file found. Skipping concatenation.");
             const singleFilePath = path.join(folderPath, files[0]);
             fs.renameSync(singleFilePath, finalMp3Path);
             console.log(`Renamed single file to: ${finalMp3Path}`);
             sourceMp3Path = finalMp3Path;
        } else {
            // (FFmpeg list creation and spawn logic remains the same)
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
                 dataStream.on('end', () => { controller.close(); cleanupTempFiles(folderPath, sourceMp3Path); });
                 dataStream.on('error', (err) => { controller.error(err); cleanupTempFiles(folderPath, sourceMp3Path); });
            },
            cancel() {
                dataStream.destroy(); cleanupTempFiles(folderPath, sourceMp3Path);
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
        console.error("API /api/combine-mp3 final catch error:", error);
        let errorMessage = `Playlist MP3 combination failed: ${error.message}`;
         // yt-dlp-wrap might attach stderr to the error object
         if (error.stderr) {
             errorMessage += `\nStderr: ${error.stderr.substring(0, 500)}`;
         }
        cleanupTempFiles(folderPath, finalMp3Path);
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}

// Updated cleanup function
function cleanupTempFiles(tempFolderPath, finalFilePath) { /* ... same as before ... */
     setTimeout(() => {
        try {
            if (tempFolderPath && fs.existsSync(tempFolderPath)) {
                console.log(`CLEANUP: Removing folder: ${tempFolderPath}`);
                fs.rmSync(tempFolderPath, { recursive: true, force: true });
            }
            if (finalFilePath && finalFilePath !== tempFolderPath && fs.existsSync(finalFilePath)) {
                console.log(`CLEANUP: Removing final file: ${finalFilePath}`);
                fs.unlinkSync(finalFilePath);
            } else if (finalFilePath === tempFolderPath) {
                 console.log(`CLEANUP: Final file path was the same as temp folder path, folder already removed.`);
            }
        } catch (cleanupError) {
            console.error("CLEANUP: Error:", cleanupError);
        }
    }, 2000);
}
