// This is a Next.js API route for downloading a single MP3 file using yt-dlp.
// opt into Node.js runtime so you can use fs, child_process, etc.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { spawn } from 'child_process'; // Use spawn for robustness
import fs from 'fs';
import path from 'path';
import os from 'os'; // Import os to use tmpdir() for better portability

export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (MP3 DIRECT) API ROUTE HIT ---');
  const { url } = await request.json();
  if (!url) {
    return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
  }

  // Use OS temporary directory for better portability
  const tempDir = path.join(os.tmpdir(), `single_dl_${Date.now()}`);
  // Define the expected final MP3 path
  const expectedMp3Filename = 'downloaded_audio.mp3'; // Keep a fixed name for simplicity
  const expectedMp3Path = path.join(tempDir, expectedMp3Filename);
  let actualFilePathToStream = null; // Track the file to stream for cleanup

  try {
    console.log(`Attempting to create temporary directory: ${tempDir}`);
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`Temporary directory created: ${tempDir}`);

    // --- 1. Download Single MP3 with yt-dlp using spawn ---
    console.log(`Spawning yt-dlp to download and convert to single MP3`);

    // Define arguments for spawn
    const ytdlpArgs = [
        '-x', // Extract audio
        '--audio-format', 'mp3', // Specify MP3 format
        // Explicitly set the *final* output filename as .mp3
        '-o', expectedMp3Path,
        // Remove: '--print', 'filename', // Not needed anymore
        url // The URL for the single video/audio
    ];
    console.log('yt-dlp args:', ytdlpArgs);

    let stderrData = '';

    await new Promise((resolve, reject) => { // No need to capture filename from promise anymore
        const ytDlpProcess = spawn('yt-dlp', ytdlpArgs, { shell: false });

        // No need to capture stdout anymore
        // ytDlpProcess.stdout.on('data', (data) => { ... });

        ytDlpProcess.stderr.on('data', (data) => {
            console.error(`yt-dlp stderr: ${data}`);
            stderrData += data.toString();
        });
        ytDlpProcess.on('error', (err) => {
            reject(new Error(`yt-dlp spawn error: ${err.message}`));
        });
        ytDlpProcess.on('close', (code) => {
            if (code === 0) {
                // Check if the expected MP3 file exists
                if (fs.existsSync(expectedMp3Path)) {
                    console.log(`yt-dlp finished successfully. Found expected MP3: ${expectedMp3Path}`);
                    resolve(); // Just resolve, we know the path
                } else {
                    // If the expected file isn't there, something went wrong
                    const files = fs.readdirSync(tempDir); // See what IS there
                    reject(new Error(`yt-dlp finished successfully (code 0), but the expected MP3 file (${expectedMp3Filename}) was not found in ${tempDir}. Files present: ${files.join(', ')}`));
                }
            } else {
                reject(new Error(`yt-dlp failed with exit code ${code}. Stderr: ${stderrData.substring(0, 500)}`));
            }
        });
    });

    console.log('yt-dlp MP3 download and conversion finished.');
    actualFilePathToStream = expectedMp3Path; // Store the path for streaming & cleanup

    // --- 2. Prepare and Stream the MP3 File ---
    const stats = fs.statSync(actualFilePathToStream);
    const dataStream = fs.createReadStream(actualFilePathToStream);
    const filenameForUser = expectedMp3Filename; // Use the fixed name or derive from URL if needed

    console.log(`Streaming MP3 file: ${actualFilePathToStream}, Size: ${stats.size}`);

    // Use ReadableStream for better cleanup handling with NextResponse
    const responseStream = new ReadableStream({
        start(controller) {
            dataStream.on('data', (chunk) => {
                controller.enqueue(chunk);
            });
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
        'Content-Disposition': `attachment; filename="${filenameForUser}"`,
        'Content-Length': stats.size.toString(),
      },
    });

  } catch (error) {
    console.error('API /api/download final catch error:', error);
    cleanupTempFiles(tempDir); // Clean up folder if it exists on error
    return NextResponse.json({ error: `Download failed: ${error.message}` }, { status: 500 });
  }
}

// Updated Helper function for cleanup (only needs folder path)
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
    }, 1000); // 1 second delay
}
