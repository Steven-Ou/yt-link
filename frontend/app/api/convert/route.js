export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
// No AdmZip needed
import { spawn } from 'child_process'; // Keep spawn

// Helper function to sort files based on playlist index prefix
const sortFilesByPlaylistIndex = (a, b) => {
    const regex = /^(\d+)\./; // Matches digits at the start followed by a dot
    const matchA = a.match(regex);
    const matchB = b.match(regex);
    const indexA = matchA ? parseInt(matchA[1], 10) : Infinity;
    const indexB = matchB ? parseInt(matchB[1], 10) : Infinity;
    return indexA - indexB;
};

export async function POST(request) {
    console.log('--- COMBINE PLAYLIST TO SINGLE MP3 API ROUTE HIT ---');
    let folder;
    let ffmpegListPath;
    let finalMp3Path;

    try {
        const { playlistUrl } = await request.json();
        if (!playlistUrl) {
            return NextResponse.json({ error: 'No playlist URL provided' }, { status: 400 });
        }
        console.log(`Received playlist URL: ${playlistUrl}`);

        folder = `playlist_mp3s_${Date.now()}`;
        const folderPath = path.resolve(folder);
        fs.mkdirSync(folderPath);
        console.log(`MP3 download directory created: ${folderPath}`);

        // --- 1. Download Individual MP3s with yt-dlp ---
        console.log(`Spawning yt-dlp to download and extract MP3s`);
        const ytdlpArgs = [
            '-x', // Extract audio
            '--audio-format', 'mp3', // Specify MP3 format
            // Output template with index for sorting and correct extension
            '-o', path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s'),
            playlistUrl
        ];
        console.log('yt-dlp args:', ytdlpArgs);

        await new Promise((resolve, reject) => {
            const ytDlpProcess = spawn('yt-dlp', ytdlpArgs, { shell: false });
            let stderrOutput = '';
            ytDlpProcess.stdout.on('data', (data) => { /* process.stdout.write('.'); */ }); // Minimal progress
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
        files = files.filter(f => f.toLowerCase().endsWith('.mp3')); // Filter specifically for .mp3 files
        files.sort(sortFilesByPlaylistIndex); // Sort based on the number prefix

        if (files.length === 0) {
            throw new Error('yt-dlp did not produce any MP3 files.');
        }
        if (files.length === 1) {
             console.warn("Only one MP3 file found. Skipping concatenation, serving the single file.");
             finalMp3Path = path.join(folderPath, files[0]); // Serve the single file directly
        } else {
            console.log(`Found and sorted MP3 files for concatenation:`, files);

            // --- 3. Create File List for FFmpeg (Only if multiple files) ---
            ffmpegListPath = path.join(folderPath, 'mylist.txt');
            const fileListContent = files.map(file => `file '${path.join(folderPath, file).replace(/'/g, "'\\''")}'`).join('\n');
            fs.writeFileSync(ffmpegListPath, fileListContent);
            console.log(`Generated FFmpeg file list: ${ffmpegListPath}`);

            // --- 4. Run FFmpeg to Concatenate MP3s (Only if multiple files) ---
            finalMp3Path = path.resolve(`${folder}_combined.mp3`); // Define final path
            console.log(`Spawning ffmpeg to combine MP3s into: ${finalMp3Path}`);

            const ffmpegArgs = [
                '-f', 'concat',     // Use the concat demuxer
                '-safe', '0',       // Allow absolute/relative paths in list
                '-i', ffmpegListPath, // Input is the text file list
                '-c', 'copy',       // <<< Copy MP3 data (fast, should work)
                finalMp3Path      // Output file path
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
                         // If -c copy fails for MP3 (less likely), removing it might help but adds re-encoding overhead.
                         console.error(`ffmpeg failed with code ${code}. Check if input MP3s are valid.`);
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
        const data = fs.createReadStream(finalMp3Path);
        console.log(`Streaming final MP3: ${finalMp3Path}, Size: ${stats.size}`);

        const response = new NextResponse(data, {
            status: 200,
            headers: {
                'Content-Disposition': `attachment; filename="${path.basename(finalMp3Path)}"`,
                'Content-Type': 'audio/mpeg', // Correct MIME type for MP3
                'Content-Length': stats.size.toString(),
            },
        });
        return response;

    } catch (error) {
        console.error("API /api/combine-playlist-mp3 final catch error:", error);
        // Ensure partial cleanup happens even on error before this point
        if (folder && fs.existsSync(path.resolve(folder))) {
             console.log("Cleaning up folder due to error:", path.resolve(folder));
             fs.rmSync(path.resolve(folder), { recursive: true, force: true });
        }
        if (finalMp3Path && fs.existsSync(path.resolve(finalMp3Path))) {
            console.log("Cleaning up final MP3 due to error:", path.resolve(finalMp3Path));
            fs.unlinkSync(path.resolve(finalMp3Path));
        }
        return NextResponse.json({ error: `Playlist MP3 combination failed: ${error.message}` }, { status: 500 });
    } finally {
        // --- 6. Cleanup ---
        // Cleanup runs *after* the response stream should have finished (or after error)
        setTimeout(() => {
            try {
                const folderPathToDelete = folder ? path.resolve(folder) : null;
                // ffmpegListPath is inside folderPathToDelete
                const mp3FilePathToDelete = finalMp3Path ? path.resolve(finalMp3Path) : null;

                // Delete the folder containing individual MP3s and the list file
                if (folderPathToDelete && fs.existsSync(folderPathToDelete)) {
                    console.log(`FINALLY: Cleaning up folder: ${folderPathToDelete}`);
                    fs.rmSync(folderPathToDelete, { recursive: true, force: true });
                }
                // Delete the combined/final MP3 file
                if (mp3FilePathToDelete && fs.existsSync(mp3FilePathToDelete)) {
                    console.log(`FINALLY: Cleaning up final MP3 file: ${mp3FilePathToDelete}`);
                    fs.unlinkSync(mp3FilePathToDelete);
                }
            } catch (cleanupError) {
                console.error("FINALLY: Cleanup error:", cleanupError);
            }
        }, 5000); // Delay might still be useful for streaming response
    }
}