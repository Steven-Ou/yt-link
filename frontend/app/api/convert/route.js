// /app/api/convert/route.js OR /app/api/combine-mp3/route.js

// Uses execFile for yt-dlp, keeps spawn for ffmpeg.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { execFile, spawn } from 'child_process'; // Need both
import fs from 'fs';
import path from 'path';
import os from 'os';
// Keep yt-dlp-exec installed for its binary
// import ytDlpExec from 'yt-dlp-exec'; // No longer calling the wrapper

// --- Find the yt-dlp binary path ---
let ytDlpPath;
try {
    const packagePath = require.resolve('yt-dlp-exec');
    const binPathGuess = path.join(path.dirname(packagePath), '../bin/yt-dlp');
    const binPathGuessExe = path.join(path.dirname(packagePath), '../bin/yt-dlp.exe');
    if (fs.existsSync(binPathGuess)) {
        ytDlpPath = binPathGuess;
    } else if (fs.existsSync(binPathGuessExe)) {
        ytDlpPath = binPathGuessExe;
    } else {
         const directPath = path.join(process.cwd(), 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
         const directPathExe = path.join(process.cwd(), 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe');
         if (fs.existsSync(directPath)) { ytDlpPath = directPath; }
         else if (fs.existsSync(directPathExe)) { ytDlpPath = directPathExe; }
         else { throw new Error('yt-dlp binary not found via require.resolve or direct path.'); }
    }
    console.log(`Found yt-dlp binary at: ${ytDlpPath}`);
} catch (err) {
    console.error("Error finding yt-dlp path:", err);
    ytDlpPath = null;
}
// --- End find binary path ---


// Helper function to sort files
const sortFilesByPlaylistIndex = (a, b) => {
    const regex = /^(\d+)\./;
    const matchA = a.match(regex);
    const matchB = b.match(regex);
    const indexA = matchA ? parseInt(matchA[1], 10) : Infinity;
    const indexB = matchB ? parseInt(matchB[1], 10) : Infinity;
    return indexA - indexB;
};

export async function POST(request) {
    console.log('--- COMBINE PLAYLIST MP3 (execFile for yt-dlp) API ROUTE HIT ---');

    // Check if ytDlpPath was found
    if (!ytDlpPath) {
        console.error("yt-dlp binary path could not be determined. Ensure 'yt-dlp-exec' is installed.");
        return NextResponse.json({ error: "Server configuration error: yt-dlp not found." }, { status: 500 });
    }

    const baseTempDir = os.tmpdir();
    const uniqueFolderName = `playlist_mp3s_${Date.now()}`;
    const folderPath = path.join(baseTempDir, uniqueFolderName);

    let ffmpegListPath = null;
    let finalMp3Path = null;

    try {
        const { playlistUrl } = await request.json();
        if (!playlistUrl) {
            return NextResponse.json({ error: 'No playlist URL provided' }, { status: 400 });
        }
        console.log(`Received playlist URL: ${playlistUrl}`);
        console.log(`Attempting to create temporary directory: ${folderPath}`);
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`MP3 download directory created: ${folderPath}`);

        // --- 1. Download Individual MP3s using execFile ---
        console.log(`Executing yt-dlp binary directly from: ${ytDlpPath}`);
        const outputPathTemplate = path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s');

        // Define arguments for execFile
        const args = [
            playlistUrl, // URL first
            '-x', // Extract audio
            '--audio-format', 'mp3', // Specify MP3 format
            '-o', outputPathTemplate // Output template
        ];
        console.log('yt-dlp execFile args:', args);

        // Execute using execFile
        await new Promise((resolve, reject) => {
            execFile(ytDlpPath, args, (error, stdout, stderr) => {
                if (stdout) console.log('yt-dlp stdout:\n', stdout);
                if (stderr) console.error('yt-dlp stderr:\n', stderr);
                if (error) {
                    console.error(`yt-dlp execFile error: ${error.message}`);
                    error.stderrContent = stderr;
                    return reject(error);
                }
                console.log('yt-dlp execFile finished successfully.');
                resolve({ stdout, stderr });
            });
        });


        // --- 2. List and Sort MP3 Files ---
        // (Logic remains the same)
        let files = fs.readdirSync(folderPath);
        files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
        files.sort(sortFilesByPlaylistIndex);
        if (files.length === 0) {
             throw new Error(`yt-dlp did not produce any MP3 files.`);
        }

        if (files.length === 1) {
             console.warn("Only one MP3 file found. Skipping concatenation.");
             finalMp3Path = path.join(folderPath, files[0]);
        } else {
            console.log(`Found and sorted MP3 files for concatenation:`, files);

            // --- 3. Create File List for FFmpeg ---
            // (Logic remains the same)
            ffmpegListPath = path.join(folderPath, 'mylist.txt');
            const fileListContent = files.map(file => `file '${path.join(folderPath, file).replace(/'/g, "'\\''")}'`).join('\n');
            fs.writeFileSync(ffmpegListPath, fileListContent);
            console.log(`Generated FFmpeg file list: ${ffmpegListPath}`);

            // --- 4. Run FFmpeg to Concatenate MP3s (using spawn) ---
            // (Logic remains the same - still relies on ffmpeg being available)
            finalMp3Path = path.join(baseTempDir, `${uniqueFolderName}_combined.mp3`);
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
        }

        // --- 5. Respond with the combined (or single) MP3 ---
        // (Streaming logic remains the same)
        if (!finalMp3Path || !fs.existsSync(finalMp3Path)) {
            throw new Error("Final MP3 file path not found or not generated.");
        }
        const stats = fs.statSync(finalMp3Path);
        const dataStream = fs.createReadStream(finalMp3Path);
        const filenameForUser = path.basename(finalMp3Path);
        console.log(`Streaming final MP3: ${finalMp3Path}, Size: ${stats.size}`);
        const fallbackFilename = 'combined_playlist.mp3';
        const encodedFilename = encodeURIComponent(filenameForUser);
        const contentDispositionValue = `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`;
        const responseStream = new ReadableStream({
            start(controller) { /* ... stream handling ... */
                 dataStream.on('data', (chunk) => controller.enqueue(chunk));
                 dataStream.on('end', () => { controller.close(); cleanupTempFiles(folderPath, finalMp3Path); });
                 dataStream.on('error', (err) => { controller.error(err); cleanupTempFiles(folderPath, finalMp3Path); });
            },
            cancel() { /* ... cancel handling ... */
                dataStream.destroy(); cleanupTempFiles(folderPath, finalMp3Path);
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
        cleanupTempFiles(folderPath, finalMp3Path);
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}

// Updated cleanup function
function cleanupTempFiles(tempFolderPath, finalFilePath) {
     setTimeout(() => {
        try {
            if (tempFolderPath && fs.existsSync(tempFolderPath)) {
                console.log(`CLEANUP: Removing folder: ${tempFolderPath}`);
                fs.rmSync(tempFolderPath, { recursive: true, force: true });
            }
            if (finalFilePath && fs.existsSync(finalFilePath)) {
                console.log(`CLEANUP: Removing final file: ${finalFilePath}`);
                fs.unlinkSync(finalFilePath);
            }
        } catch (cleanupError) {
            console.error("CLEANUP: Error:", cleanupError);
        }
    }, 2000);
}
