// /app/api/download/route.js

// Uses yt-dlp-wrap which downloads the binary to /tmp if needed.
// Uses video title for output filename.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
// Import the new library
import YTDlpWrap from 'yt-dlp-wrap';

// Instantiate the wrapper
const ytDlpWrap = new YTDlpWrap();

export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (yt-dlp-wrap) API ROUTE HIT ---');

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

    // --- 1. Download Single MP3 using yt-dlp-wrap ---
    console.log(`Executing yt-dlp-wrap to download and convert`);

    // Define output path template using video title
    const outputTemplate = path.join(tempDir, '%(title)s.%(ext)s');

    // Define arguments for yt-dlp-wrap
    const args = [
        url, // URL first
        '-x', // Extract audio
        '--audio-format', 'mp3', // Specify MP3 format
        '-o', outputTemplate // Output template
    ];
    console.log('yt-dlp-wrap args:', args);

    // Execute using the wrapper instance
    await ytDlpWrap.exec(args);
    console.log('yt-dlp-wrap download execution finished.');


    // Find the downloaded MP3 file (as filename is dynamic)
    console.log(`Searching for MP3 file in ${tempDir}`);
    const files = fs.readdirSync(tempDir);
    const mp3File = files.find(f => f.toLowerCase().endsWith('.mp3'));

    if (mp3File) {
        actualMp3Path = path.join(tempDir, mp3File);
        console.log(`Found downloaded MP3: ${actualMp3Path}`);
    } else {
        throw new Error(`yt-dlp finished, but no MP3 file was found in ${tempDir}. Files present: ${files.join(', ')}.`);
    }

    console.log('MP3 download and conversion finished.');

    // --- 2. Prepare and Stream the MP3 File ---
    // (Streaming logic remains the same)
    const stats = fs.statSync(actualMp3Path);
    const dataStream = fs.createReadStream(actualMp3Path);
    const filenameForUser = path.basename(actualMp3Path);
    console.log(`Streaming MP3 file: ${actualMp3Path}, Size: ${stats.size}, Filename for user: ${filenameForUser}`);
    const fallbackFilename = 'downloaded_audio.mp3';
    const encodedFilename = encodeURIComponent(filenameForUser);
    const contentDispositionValue = `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`;
    console.log(`Setting Content-Disposition: ${contentDispositionValue}`);
    const responseStream = new ReadableStream({
        start(controller) { /* ... stream handling ... */
            dataStream.on('data', (chunk) => controller.enqueue(chunk));
            dataStream.on('end', () => { controller.close(); cleanupTempFiles(tempDir); });
            dataStream.on('error', (err) => { controller.error(err); cleanupTempFiles(tempDir); });
        },
        cancel() { /* ... cancel handling ... */
             dataStream.destroy(); cleanupTempFiles(tempDir);
        }
    });
    return new NextResponse(responseStream, {
      status: 200,
      headers: { /* ... headers ... */
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': contentDispositionValue,
        'Content-Length': stats.size.toString(),
       },
    });

  } catch (error) {
    console.error('API /api/download final catch error:', error);
    let errorMessage = `Download failed: ${error.message}`;
    // yt-dlp-wrap might attach stderr to the error object
    if (error.stderr) {
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
