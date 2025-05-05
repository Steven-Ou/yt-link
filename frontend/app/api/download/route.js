// This is a Next.js API route for downloading a single MP3 file using yt-dlp.
// opt into Node.js runtime so you can use fs, child_process, etc.
// This version uses the video title for the filename.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (DYNAMIC MP3 NAME) API ROUTE HIT ---');
  const { url } = await request.json();
  if (!url) {
    return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
  }

  const tempDir = path.join(os.tmpdir(), `single_dl_${Date.now()}`);
  let actualMp3Path = null; // Will store the path to the dynamically named MP3

  try {
    console.log(`Attempting to create temporary directory: ${tempDir}`);
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`Temporary directory created: ${tempDir}`);

    // --- 1. Download Single MP3 with yt-dlp using title template ---
    console.log(`Spawning yt-dlp to download and convert to single MP3 using title`);

    // Define arguments for spawn
    const ytdlpArgs = [
        '-x', // Extract audio
        '--audio-format', 'mp3', // Specify MP3 format
        // Use yt-dlp's template to include the video title in the filename.
        // Outputting directly into the temp directory.
        // %(title)s will be replaced by the video title (sanitized by yt-dlp).
        // %(ext)s will be replaced by the correct extension (mp3 after conversion).
        '-o', path.join(tempDir, '%(title)s.%(ext)s'),
        url // The URL for the single video/audio
    ];
    console.log('yt-dlp args:', ytdlpArgs);

    let stderrData = '';

    await new Promise((resolve, reject) => {
        const ytDlpProcess = spawn('yt-dlp', ytdlpArgs, { shell: false });

        ytDlpProcess.stderr.on('data', (data) => {
            // Log stderr but don't necessarily treat it as fatal unless exit code is non-zero
            console.error(`yt-dlp stderr: ${data}`);
            stderrData += data.toString();
        });
        ytDlpProcess.on('error', (err) => {
            reject(new Error(`yt-dlp spawn error: ${err.message}`));
        });
        ytDlpProcess.on('close', (code) => {
            if (code === 0) {
                 console.log(`yt-dlp process finished successfully (code 0).`);
                 // Since the filename is dynamic, we need to find the MP3 file.
                 try {
                     const files = fs.readdirSync(tempDir);
                     // Find the first file ending with .mp3 (case-insensitive)
                     const mp3File = files.find(f => f.toLowerCase().endsWith('.mp3'));

                     if (mp3File) {
                         actualMp3Path = path.join(tempDir, mp3File); // Store the full path
                         console.log(`Found downloaded MP3: ${actualMp3Path}`);
                         resolve(); // Success!
                     } else {
                         reject(new Error(`yt-dlp finished, but no MP3 file was found in ${tempDir}. Files present: ${files.join(', ')}`));
                     }
                 } catch (readDirError) {
                     reject(new Error(`yt-dlp finished, but failed to read temp directory ${tempDir}: ${readDirError.message}`));
                 }
            } else {
                reject(new Error(`yt-dlp failed with exit code ${code}. Stderr: ${stderrData.substring(0, 500)}`));
            }
        });
    });

    console.log('yt-dlp MP3 download and conversion finished.');

    if (!actualMp3Path) {
        // This should technically not be reachable if the promise resolved, but safety check.
        throw new Error("MP3 file path was not determined after download.");
    }

    // --- 2. Prepare and Stream the Dynamically Named MP3 File ---
    const stats = fs.statSync(actualMp3Path);
    const dataStream = fs.createReadStream(actualMp3Path);
    // Extract the dynamic filename part to send to the user
    const filenameForUser = path.basename(actualMp3Path);

    console.log(`Streaming MP3 file: ${actualMp3Path}, Size: ${stats.size}, Filename for user: ${filenameForUser}`);

    // Use ReadableStream for better cleanup handling
    const responseStream = new ReadableStream({
        start(controller) {
            dataStream.on('data', (chunk) => controller.enqueue(chunk));
            dataStream.on('end', () => {
                console.log('File stream ended.');
                controller.close();
                cleanupTempFiles(tempDir); // Clean up AFTER the stream ends
            });
            dataStream.on('error', (err) => {
                console.error('File stream error:', err);
                controller.error(err);
                cleanupTempFiles(tempDir); // Clean up on stream error
            });
        },
        cancel() {
            console.log('Response stream cancelled by client.');
            dataStream.destroy();
            cleanupTempFiles(tempDir); // Clean up on cancellation
        }
    });

    return new NextResponse(responseStream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        // Send the ACTUAL filename found in the Content-Disposition header
        'Content-Disposition': `attachment; filename="${filenameForUser}"`,
        'Content-Length': stats.size.toString(),
      },
    });

  } catch (error) {
    console.error('API /api/download final catch error:', error);
    cleanupTempFiles(tempDir); // Clean up folder if it exists on error
    // Send error back as JSON
    return NextResponse.json({ error: `Download failed: ${error.message}` }, { status: 500 });
  }
}

// Helper function for cleanup (only needs folder path)
function cleanupTempFiles(folderPath) {
     setTimeout(() => {
        try {
            if (folderPath && fs.existsSync(folderPath)) {
                console.log(`CLEANUP: Removing folder: ${folderPath}`);
                fs.rmSync(folderPath, { recursive: true, force: true });
            }
        } catch (cleanupError) {
            console.error("CLEANUP: Error:", cleanupError);
        }
    }, 1000); // Delay might help ensure stream closes fully
}
