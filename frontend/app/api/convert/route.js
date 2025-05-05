// /app/api/convert/route.js 

// Uses playlist title for output filename.
// Uses execFile for yt-dlp, spawn for ffmpeg.
// Includes enhanced logging for yt-dlp path resolution.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { execFile, spawn } from 'child_process'; // Need both
import fs from 'fs';
import path from 'path';
import os from 'os';
// Keep yt-dlp-exec installed for its binary
// import ytDlpExec from 'yt-dlp-exec'; // No longer calling the wrapper

// --- Find the yt-dlp binary path (with enhanced logging) ---
let ytDlpPath = null;
const searchPaths = [];
try {
    console.log("Attempting to find yt-dlp binary path...");
    console.log("Current working directory (process.cwd()):", process.cwd());
    // Method 1: Via require.resolve
    try {
        const packagePath = require.resolve('yt-dlp-exec');
        console.log("Path resolved by require.resolve('yt-dlp-exec'):", packagePath);
        const binPathGuess1 = path.join(path.dirname(packagePath), '../bin/yt-dlp');
        const binPathGuessExe1 = path.join(path.dirname(packagePath), '../bin/yt-dlp.exe');
        searchPaths.push(binPathGuess1, binPathGuessExe1);
        if (fs.existsSync(binPathGuess1)) { ytDlpPath = binPathGuess1; }
        else if (fs.existsSync(binPathGuessExe1)) { ytDlpPath = binPathGuessExe1; }
        console.log("Path after require.resolve method:", ytDlpPath);
    } catch (resolveError) { console.warn("require.resolve('yt-dlp-exec') failed:", resolveError.message); }
    // Method 2: Direct path relative to cwd
    if (!ytDlpPath) {
        console.log("Trying direct path from node_modules...");
        const directPath = path.join(process.cwd(), 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
        const directPathExe = path.join(process.cwd(), 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe');
        searchPaths.push(directPath, directPathExe);
        if (fs.existsSync(directPath)) { ytDlpPath = directPath; }
        else if (fs.existsSync(directPathExe)) { ytDlpPath = directPathExe; }
        console.log("Path after direct node_modules method:", ytDlpPath);
    }
     // Method 3: Check common Vercel path structure
     if (!ytDlpPath) {
        console.log("Trying potential Vercel path structure...");
        const vercelPath = path.resolve(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
        const vercelPathExe = path.resolve(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe');
         searchPaths.push(vercelPath, vercelPathExe);
        if (fs.existsSync(vercelPath)) { ytDlpPath = vercelPath; }
        else if (fs.existsSync(vercelPathExe)) { ytDlpPath = vercelPathExe; }
         console.log("Path after Vercel __dirname method:", ytDlpPath);
     }
    if (ytDlpPath) {
        console.log(`Successfully determined yt-dlp binary path: ${ytDlpPath}`);
        try { // Check permissions
            fs.accessSync(ytDlpPath, fs.constants.X_OK);
            console.log(`Execute permission confirmed for: ${ytDlpPath}`);
        } catch (permError) {
            console.error(`Execute permission DENIED for ${ytDlpPath}: ${permError.message}`);
            try { // Attempt chmod
                 console.log(`Attempting to chmod +x ${ytDlpPath}`);
                 fs.chmodSync(ytDlpPath, 0o755);
                 console.log(`chmod successful.`);
                 fs.accessSync(ytDlpPath, fs.constants.X_OK);
                 console.log(`Execute permission confirmed after chmod.`);
            } catch (chmodError) {
                 console.error(`chmod failed or permission still denied after chmod: ${chmodError.message}`);
                 throw new Error(`yt-dlp binary found but lacks execute permissions and chmod failed: ${ytDlpPath}`);
            }
        }
    } else {
        console.error("Failed to find yt-dlp binary after checking multiple paths.");
        console.error("Paths searched:", searchPaths);
        throw new Error('yt-dlp binary not found in expected locations.');
    }
} catch (err) {
    console.error("CRITICAL Error during yt-dlp path resolution:", err);
    ytDlpPath = null;
}
// --- End find binary path ---


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
function sanitizeFilename(name) {
    // Remove characters invalid in most file systems, replace with underscore
    return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'untitled';
}

export async function POST(request) {
    console.log('--- COMBINE PLAYLIST MP3 (Playlist Title Name) API ROUTE HIT ---');

    if (!ytDlpPath) {
        console.error("yt-dlp binary path could not be determined. Ensure 'yt-dlp-exec' is installed.");
        return NextResponse.json({ error: "Server configuration error: yt-dlp not found." }, { status: 500 });
    }

    const baseTempDir = os.tmpdir();
    const uniqueFolderName = `playlist_dl_${Date.now()}`; // Folder for individual downloads
    const folderPath = path.join(baseTempDir, uniqueFolderName);

    let ffmpegListPath = null;
    let finalMp3Path = null; // Will be based on playlist title
    let playlistTitle = 'combined_playlist'; // Default title

    try {
        const { playlistUrl } = await request.json();
        if (!playlistUrl) {
            return NextResponse.json({ error: 'No playlist URL provided' }, { status: 400 });
        }
        console.log(`Received playlist URL: ${playlistUrl}`);

        // --- 0. Get Playlist Title ---
        try {
            console.log(`Fetching playlist title for: ${playlistUrl}`);
            const titleArgs = [
                playlistUrl,
                '--flat-playlist', // Don't extract info for each video
                '--dump-single-json' // Get metadata for the playlist itself
            ];
            console.log('yt-dlp execFile args (for title):', titleArgs);
            const { stdout: titleJson } = await new Promise((resolve, reject) => {
                 execFile(ytDlpPath, titleArgs, (error, stdout, stderr) => {
                     if (stderr) console.error('yt-dlp stderr (title fetch):\n', stderr);
                     if (error) {
                         console.error(`yt-dlp execFile error (title fetch): ${error.message}`);
                         error.stderrContent = stderr;
                         return reject(error); // Reject if title fetch fails
                     }
                     resolve({ stdout, stderr });
                 });
             });

            const playlistInfo = JSON.parse(titleJson);
            if (playlistInfo && playlistInfo.title) {
                playlistTitle = sanitizeFilename(playlistInfo.title); // Sanitize the title
                console.log(`Using sanitized playlist title: ${playlistTitle}`);
            } else {
                 console.warn("Could not extract playlist title from JSON, using default.");
            }
        } catch (titleError) {
            console.error(`Failed to fetch or parse playlist title: ${titleError.message}. Using default name.`);
            // Keep the default playlistTitle = 'combined_playlist'
        }

        // --- Now define the final output path using the title ---
        finalMp3Path = path.join(baseTempDir, `${playlistTitle}.mp3`);
        console.log(`Final combined MP3 path set to: ${finalMp3Path}`);


        // --- 1. Download Individual MP3s using execFile ---
        console.log(`Attempting to create temporary directory: ${folderPath}`);
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`MP3 download directory created: ${folderPath}`);
        console.log(`Executing yt-dlp binary to download items into: ${folderPath}`);
        const outputPathTemplate = path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s');
        const downloadArgs = [ playlistUrl, '-x', '--audio-format', 'mp3', '-o', outputPathTemplate ];
        console.log('yt-dlp execFile args (for download):', downloadArgs);

        await new Promise((resolve, reject) => {
            console.log(`Calling execFile with path: ${ytDlpPath}`);
            const child = execFile(ytDlpPath, downloadArgs, (error, stdout, stderr) => {
                if (stdout) console.log('yt-dlp stdout (download):\n', stdout);
                if (stderr) console.error('yt-dlp stderr (download):\n', stderr);
                if (error) {
                    console.error(`yt-dlp execFile FAILED (download). Error Code: ${error.code}, Signal: ${error.signal}`);
                    console.error(`Error Message: ${error.message}`);
                    error.stderrContent = stderr;
                    return reject(error);
                }
                console.log('yt-dlp execFile finished successfully (download).');
                resolve({ stdout, stderr });
            });
             child.on('spawn', () => console.log(`execFile successfully spawned the download process for ${ytDlpPath}`));
             child.on('error', (spawnError) => console.error(`execFile child process emitted 'error' event (download): ${spawnError.message}`));
        });


        // --- 2. List and Sort MP3 Files ---
        let files = fs.readdirSync(folderPath);
        files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
        files.sort(sortFilesByPlaylistIndex);
        if (files.length === 0) { throw new Error(`yt-dlp did not produce any MP3 files.`); }

        // --- 3. Combine if necessary ---
        let sourceMp3Path = null; // Path to the file we will stream
        if (files.length === 1) {
             console.warn("Only one MP3 file found. Skipping concatenation.");
             // Move the single file to the final path name
             const singleFilePath = path.join(folderPath, files[0]);
             fs.renameSync(singleFilePath, finalMp3Path); // Rename the single file
             console.log(`Renamed single file to: ${finalMp3Path}`);
             sourceMp3Path = finalMp3Path;
        } else {
            console.log(`Found ${files.length} MP3 files for concatenation.`);
            // Create File List for FFmpeg
            ffmpegListPath = path.join(folderPath, 'mylist.txt');
            const fileListContent = files.map(file => `file '${path.join(folderPath, file).replace(/'/g, "'\\''")}'`).join('\n');
            fs.writeFileSync(ffmpegListPath, fileListContent);
            console.log(`Generated FFmpeg file list: ${ffmpegListPath}`);

            // Run FFmpeg (using spawn)
            console.log(`Spawning ffmpeg to combine MP3s into: ${finalMp3Path}`);
            const ffmpegArgs = [ '-f', 'concat', '-safe', '0', '-i', ffmpegListPath, '-c', 'copy', finalMp3Path ];
            console.log('ffmpeg args:', ffmpegArgs);
            await new Promise((resolve, reject) => {
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
            sourceMp3Path = finalMp3Path; // The combined file is the source
        }

        // --- 4. Respond with the final MP3 ---
        if (!sourceMp3Path || !fs.existsSync(sourceMp3Path)) {
            throw new Error("Final MP3 file path not found or not generated.");
        }
        const stats = fs.statSync(sourceMp3Path);
        const dataStream = fs.createReadStream(sourceMp3Path);
        // Use the sanitized playlist title (or default) for the user-facing filename
        const filenameForUser = path.basename(sourceMp3Path); // Already includes .mp3

        console.log(`Streaming final MP3: ${sourceMp3Path}, Size: ${stats.size}`);

        // Encode filename for header
        const fallbackFilename = 'combined_playlist.mp3'; // Simple fallback
        const encodedFilename = encodeURIComponent(filenameForUser);
        const contentDispositionValue = `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`;

        const responseStream = new ReadableStream({
            start(controller) { /* ... stream handling ... */
                 dataStream.on('data', (chunk) => controller.enqueue(chunk));
                 dataStream.on('end', () => { controller.close(); cleanupTempFiles(folderPath, sourceMp3Path); }); // Clean up folder and final file
                 dataStream.on('error', (err) => { controller.error(err); cleanupTempFiles(folderPath, sourceMp3Path); });
            },
            cancel() { /* ... cancel handling ... */
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
         if (error.stderrContent) { // Add stderr from yt-dlp errors if present
             errorMessage += `\nStderr: ${error.stderrContent.substring(0, 500)}`;
         }
        cleanupTempFiles(folderPath, finalMp3Path); // Clean up potentially created files/folders
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}

// Updated cleanup function - cleans download folder and final output file
function cleanupTempFiles(tempFolderPath, finalFilePath) {
     setTimeout(() => {
        try {
            if (tempFolderPath && fs.existsSync(tempFolderPath)) {
                console.log(`CLEANUP: Removing folder: ${tempFolderPath}`);
                fs.rmSync(tempFolderPath, { recursive: true, force: true });
            }
            // Make sure we don't try to delete the folder path if it was used as the final path (single file case)
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
