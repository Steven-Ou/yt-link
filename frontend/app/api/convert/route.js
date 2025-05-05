// /app/api/convert/route.js OR /app/api/combine-mp3/route.js

// Fixes yt-dlp ENOENT using yt-dlp-exec.
// NOTE: This does NOT fix potential issues with ffmpeg availability on Vercel.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process'; // Keep spawn for ffmpeg
import os from 'os';
import ytDlpExec from 'yt-dlp-exec'; // Use yt-dlp-exec

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
    console.log('--- COMBINE PLAYLIST MP3 (Fix yt-dlp ENOENT) API ROUTE HIT ---');
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

        // --- 1. Download Individual MP3s using yt-dlp-exec ---
        console.log(`Executing yt-dlp-exec to download MP3s into ${folderPath}`);
        const outputPathTemplate = path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s');

        const ytDlpOutput = await ytDlpExec(playlistUrl, {
            extractAudio: true,
            audioFormat: 'mp3',
            output: outputPathTemplate,
        });
        console.log('yt-dlp-exec playlist output:', ytDlpOutput);

        // --- 2. List and Sort MP3 Files ---
        let files = fs.readdirSync(folderPath);
        files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
        files.sort(sortFilesByPlaylistIndex);

        if (files.length === 0) {
             const stderrSnippet = ytDlpOutput?.stderr ? ytDlpOutput.stderr.substring(0, 500) : 'N/A';
             throw new Error(`yt-dlp did not produce any MP3 files. Stderr: ${stderrSnippet}`);
        }

        if (files.length === 1) {
             console.warn("Only one MP3 file found. Skipping concatenation.");
             finalMp3Path = path.join(folderPath, files[0]);
        } else {
            console.log(`Found and sorted MP3 files for concatenation:`, files);

            // --- 3. Create File List for FFmpeg ---
            ffmpegListPath = path.join(folderPath, 'mylist.txt');
            const fileListContent = files.map(file => `file '${path.join(folderPath, file).replace(/'/g, "'\\''")}'`).join('\n');
            fs.writeFileSync(ffmpegListPath, fileListContent);
            console.log(`Generated FFmpeg file list: ${ffmpegListPath}`);

            // --- 4. Run FFmpeg to Concatenate MP3s ---
            // *** NOTE: This assumes ffmpeg is available in the Vercel environment's PATH ***
            // *** This might fail with ENOENT if ffmpeg isn't installed/accessible ***
            finalMp3Path = path.join(baseTempDir, `${uniqueFolderName}_combined.mp3`);
            console.log(`Spawning ffmpeg to combine MP3s into: ${finalMp3Path}`);

            const ffmpegArgs = [ '-f', 'concat', '-safe', '0', '-i', ffmpegListPath, '-c', 'copy', finalMp3Path ];
            console.log('ffmpeg args:', ffmpegArgs);

            await new Promise((resolve, reject) => {
                const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { shell: false });
                let ffmpegStderr = '';
                ffmpegProcess.stderr.on('data', (data) => { console.error(`ffmpeg stderr: ${data}`); ffmpegStderr += data; });
                ffmpegProcess.on('error', (err) => {
                    // This is where ffmpeg ENOENT would likely happen
                    console.error(`ffmpeg spawn error: ${err.message}`);
                    reject(new Error(`ffmpeg spawn error: ${err.message}. Is ffmpeg installed/available in the environment?`));
                });
                ffmpegProcess.on('close', (code) => {
                    if (code === 0) {
                         console.log('ffmpeg MP3 concatenation finished successfully.');
                         resolve();
                    } else {
                         reject(new Error(`ffmpeg failed with code ${code}. Stderr: ${ffmpegStderr.substring(0,500)}`));
                    }
                });
            });
            console.log('FFmpeg MP3 concatenation finished.');
        }

        // --- 5. Respond with the combined (or single) MP3 ---
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
            start(controller) {
                dataStream.on('data', (chunk) => controller.enqueue(chunk));
                dataStream.on('end', () => {
                    console.log('Combined MP3 stream ended.');
                    controller.close();
                    cleanupTempFiles(folderPath, finalMp3Path);
                });
                dataStream.on('error', (err) => {
                    console.error('Combined MP3 stream error:', err);
                    controller.error(err);
                    cleanupTempFiles(folderPath, finalMp3Path);
                });
            },
            cancel() {
                console.log('Combined MP3 stream cancelled.');
                dataStream.destroy();
                cleanupTempFiles(folderPath, finalMp3Path);
            }
        });

        return new NextResponse(responseStream, {
            status: 200,
            headers: {
                'Content-Disposition': contentDispositionValue,
                'Content-Type': 'audio/mpeg',
                'Content-Length': stats.size.toString(),
            },
        });

    } catch (error) {
        console.error("API /api/combine-mp3 final catch error:", error);
        let errorMessage = `Playlist MP3 combination failed: ${error.message}`;
         if (error.stderr) { // Add stderr from yt-dlp errors if present
             errorMessage += `\nStderr: ${error.stderr.substring(0, 500)}`;
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
