// /app/api/download/route.js

// Use yt-dlp-exec to ensure binary is available on Vercel
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
// Removed: import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import ytDlpExec from 'yt-dlp-exec'; // Import the package

export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (yt-dlp-exec) API ROUTE HIT ---');
  const { url } = await request.json();
  if (!url) {
    return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
  }

  const tempDir = path.join(os.tmpdir(), `single_dl_${Date.now()}`);
  let actualMp3Path = null;

  try {
    console.log(`Attempting to create temporary directory: ${tempDir}`);
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`Temporary directory created: ${tempDir}`);

    // --- 1. Download Single MP3 using yt-dlp-exec ---
    console.log(`Executing yt-dlp-exec to download and convert`);

    // Define output path template using video title
    const outputPath = path.join(tempDir, '%(title)s.%(ext)s');

    // Execute using the library
    const ytDlpOutput = await ytDlpExec(url, {
      // Options mapping (check library docs for exact mapping if needed)
      extractAudio: true,         // -x
      audioFormat: 'mp3',         // --audio-format mp3
      output: outputPath,         // -o
      // Add any other necessary flags here
    });

    console.log('yt-dlp-exec output:', ytDlpOutput); // Library might provide stdout/stderr

    // Find the downloaded MP3 file (as filename is dynamic)
    console.log(`Searching for MP3 file in ${tempDir}`);
    const files = fs.readdirSync(tempDir);
    const mp3File = files.find(f => f.toLowerCase().endsWith('.mp3'));

    if (mp3File) {
        actualMp3Path = path.join(tempDir, mp3File);
        console.log(`Found downloaded MP3: ${actualMp3Path}`);
    } else {
        // Check stderr from output if available, or provide generic error
        const stderrSnippet = ytDlpOutput?.stderr ? ytDlpOutput.stderr.substring(0, 500) : 'N/A';
        throw new Error(`yt-dlp finished, but no MP3 file was found in ${tempDir}. Files present: ${files.join(', ')}. Stderr: ${stderrSnippet}`);
    }

    console.log('yt-dlp MP3 download and conversion finished.');

    // --- 2. Prepare and Stream the Dynamically Named MP3 File ---
    const stats = fs.statSync(actualMp3Path);
    const dataStream = fs.createReadStream(actualMp3Path);
    const filenameForUser = path.basename(actualMp3Path);

    console.log(`Streaming MP3 file: ${actualMp3Path}, Size: ${stats.size}, Filename for user: ${filenameForUser}`);

    // Encode filename for header
    const fallbackFilename = 'downloaded_audio.mp3';
    const encodedFilename = encodeURIComponent(filenameForUser);
    const contentDispositionValue = `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`;
    console.log(`Setting Content-Disposition: ${contentDispositionValue}`);

    // Use ReadableStream for better cleanup handling
    const responseStream = new ReadableStream({
        start(controller) {
            dataStream.on('data', (chunk) => controller.enqueue(chunk));
            dataStream.on('end', () => {
                console.log('File stream ended.');
                controller.close();
                cleanupTempFiles(tempDir);
            });
            dataStream.on('error', (err) => {
                console.error('File stream error:', err);
                controller.error(err);
                cleanupTempFiles(tempDir);
            });
        },
        cancel() {
            console.log('Response stream cancelled by client.');
            dataStream.destroy();
            cleanupTempFiles(tempDir);
        }
    });

    return new NextResponse(responseStream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': contentDispositionValue,
        'Content-Length': stats.size.toString(),
      },
    });

  } catch (error) {
    // Catch errors from ytDlpExec or fs operations
    console.error('API /api/download final catch error:', error);
    // Check if it's a yt-dlp specific error (library might throw custom errors)
    let errorMessage = `Download failed: ${error.message}`;
    if (error.stderr) { // Check if the error object has stderr attached
        errorMessage += `\nStderr: ${error.stderr.substring(0, 500)}`;
    }
    cleanupTempFiles(tempDir);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Helper function for cleanup
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
    }, 1000);
}
