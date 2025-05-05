// Example Path: /app/api/combine-mp3/route.js OR /app/api/convert/route.js
// Ensure this code is in the correct API route file causing the EROFS error.

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os'; // Import os module

// Helper function to sort files based on playlist index prefix
const sortFilesByPlaylistIndex = (a, b) => {
    const regex = /^(\d+)\./;
    const matchA = a.match(regex);
    const matchB = b.match(regex);
    const indexA = matchA ? parseInt(matchA[1], 10) : Infinity;
    const indexB = matchB ? parseInt(matchB[1], 10) : Infinity;
    return indexA - indexB;
};

export async function POST(request) {
    console.log('--- COMBINE PLAYLIST TO SINGLE MP3 API ROUTE HIT (Vercel Path Fix) ---');
    // *** Use os.tmpdir() for all temporary paths ***
    const baseTempDir = os.tmpdir();
    const uniqueFolderName = `playlist_mp3s_${Date.now()}`;
    const folderPath = path.join(baseTempDir, uniqueFolderName); // Path inside /tmp

    let ffmpegListPath = null; // Keep track for cleanup
    let finalMp3Path = null; // Keep track for cleanup

    try {
        const { playlistUrl } = await request.json();
        if (!playlistUrl) {
            return NextResponse.json({ error: 'No playlist URL provided' }, { status: 400 });
        }
        console.log(`Received playlist URL: ${playlistUrl}`);
        console.log(`Attempting to create temporary directory: ${folderPath}`); // Should be /tmp/...
        // Create directory inside /tmp
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`MP3 download directory created: ${folderPath}`);

        // --- 1. Download Individual MP3s with yt-dlp ---
        console.log(`Spawning yt-dlp to download and extract MP3s into ${folderPath}`);
        const ytdlpArgs = [
            '-x',
            '--audio-format', 'mp3',
            // Output template targeting the temporary folder path
            '-o', path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s'),
            playlistUrl
        ];
        console.log('yt-dlp args:', ytdlpArgs);

        await new Promise((resolve, reject) => {
            const ytDlpProcess = spawn('yt-dlp', ytdlpArgs, { shell: false });
            let stderrOutput = '';
            ytDlpProcess.stderr.on('data', (data) => { console.error(`yt-dlp stderr: ${data}`); stderrOutput += data; });
            ytDlpProcess.on('error', (err) => reject(new Error(`yt-dlp spawn error: ${err.message}`)));
            ytDlpProcess.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`yt-dlp failed with code ${code}. Stderr: ${stderrOutput.substring(0,500)}`));
            });
        });
        console.log('yt-dlp MP3 download/extraction finished.');

        // --- 2. List and Sort MP3 Files ---
        let files = fs.readdirSync(folderPath);
        files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
        files.sort(sortFilesByPlaylistIndex);

        if (files.length === 0) {
            throw new Error('yt-dlp did not produce any MP3 files.');
        }

        if (files.length === 1) {
             console.warn("Only one MP3 file found. Skipping concatenation, serving the single file.");
             // The final path is just the single file inside the temp folder
             finalMp3Path = path.join(folderPath, files[0]);
        } else {
            console.log(`Found and sorted MP3 files for concatenation:`, files);

            // --- 3. Create File List for FFmpeg (Only if multiple files) ---
            ffmpegListPath = path.join(folderPath, 'mylist.txt'); // List file also inside /tmp folder
            const fileListContent = files.map(file => `file '${path.join(folderPath, file).replace(/'/g, "'\\''")}'`).join('\n');
            fs.writeFileSync(ffmpegListPath, fileListContent);
            console.log(`Generated FFmpeg file list: ${ffmpegListPath}`);

            // --- 4. Run FFmpeg to Concatenate MP3s (Only if multiple files) ---
            // Output the combined file also to the /tmp directory initially
            finalMp3Path = path.join(baseTempDir, `${uniqueFolderName}_combined.mp3`);
            console.log(`Spawning ffmpeg to combine MP3s into: ${finalMp3Path}`);

            const ffmpegArgs = [
                '-f', 'concat',
                '-safe', '0',
                '-i', ffmpegListPath,
                '-c', 'copy',
                finalMp3Path // Output path inside /tmp
            ];
            console.log('ffmpeg args:', ffmpegArgs);

            await new Promise((resolve, reject) => {
                const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { shell: false });
                let stderrOutput = '';
                ffmpegProcess.stderr.on('data', (data) => { console.error(`ffmpeg stderr: ${data}`); stderrOutput += data; });
                ffmpegProcess.on('error', (err) => reject(new Error(`ffmpeg spawn error: ${err.message}`)));
                ffmpegProcess.on('close', (code) => {
                    if (code === 0) {
                         console.log('ffmpeg MP3 concatenation finished successfully.');
                         resolve();
                    } else {
                         reject(new Error(`ffmpeg failed with code ${code}. Stderr: ${stderrOutput.substring(0,500)}`));
                    }
                });
            });
            console.log('FFmpeg MP3 concatenation finished.');
        } // End of 'else' for multiple files

        // --- 5. Respond with the combined (or single) MP3 ---
        if (!finalMp3Path || !fs.existsSync(finalMp3Path)) {
            throw new Error("Final MP3 file path not found or not generated.");
        }
        const stats = fs.statSync(finalMp3Path);
        const dataStream = fs.createReadStream(finalMp3Path);
        const filenameForUser = path.basename(finalMp3Path); // Get filename part

        console.log(`Streaming final MP3: ${finalMp3Path}, Size: ${stats.size}`);

        // Encode filename for header
        const fallbackFilename = 'combined_playlist.mp3';
        const encodedFilename = encodeURIComponent(filenameForUser);
        const contentDispositionValue = `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`;

        // Use ReadableStream for response and cleanup
        const responseStream = new ReadableStream({
            start(controller) {
                dataStream.on('data', (chunk) => controller.enqueue(chunk));
                dataStream.on('end', () => {
                    console.log('Combined MP3 stream ended.');
                    controller.close();
                    // Clean up AFTER stream ends
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
        console.error("API /api/combine-playlist-mp3 final catch error:", error);
        // Ensure cleanup happens on error before this point
        cleanupTempFiles(folderPath, finalMp3Path); // Pass potentially existing paths
        return NextResponse.json({ error: `Playlist MP3 combination failed: ${error.message}` }, { status: 500 });
    }
    // NOTE: No finally block needed as cleanup is handled by stream events or catch block
}

// Updated cleanup function
function cleanupTempFiles(tempFolderPath, finalFilePath) {
     // Use setTimeout to slightly delay cleanup
     setTimeout(() => {
        try {
            // Delete the folder containing individual MP3s and the list file
            if (tempFolderPath && fs.existsSync(tempFolderPath)) {
                console.log(`CLEANUP: Removing folder: ${tempFolderPath}`);
                fs.rmSync(tempFolderPath, { recursive: true, force: true });
            }
            // Delete the combined/final MP3 file
            if (finalFilePath && fs.existsSync(finalFilePath)) {
                console.log(`CLEANUP: Removing final file: ${finalFilePath}`);
                fs.unlinkSync(finalFilePath);
            }
        } catch (cleanupError) {
            console.error("CLEANUP: Error:", cleanupError);
        }
    }, 2000); // Delay might help ensure stream closes fully
}
