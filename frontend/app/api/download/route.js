// /app/api/download/route.js

// Uses node-yt-dlp library.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
// Import the new library
import YTDlp from 'node-yt-dlp';

export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (node-yt-dlp) API ROUTE HIT ---');

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

    // --- 1. Download Single MP3 using node-yt-dlp ---
    console.log(`Executing node-yt-dlp to download and convert`);

    // Define output path template using video title
    const outputTemplate = path.join(tempDir, '%(title)s.%(ext)s');

    // Execute using the library's exec method
    // It takes an array of arguments.
    const args = [
        url,
        '-x', // Extract audio
        '--audio-format', 'mp3', // Specify MP3 format
        '-o', outputTemplate // Output template
    ];
    console.log('node-yt-dlp args:', args);

    // The exec method returns a promise that resolves when done
    // It might provide stdout/stderr streams via event emitters if needed
    await YTDlp.exec(args);
    console.log('node-yt-dlp download execution finished.');


    // Find the downloaded MP3 file (as filename is dynamic)
    console.log(`Searching for MP3 file in ${tempDir}`);
    const files = fs.readdirSync(tempDir);
    const mp3File = files.find(f => f.toLowerCase().endsWith('.mp3'));

    if (mp3File) {
        actualMp3Path = path.join(tempDir, mp3File);
        console.log(`Found downloaded MP3: ${actualMp3Path}`);
    } else {
        // Check logs for errors during exec if possible
        throw new Error(`node-yt-dlp finished, but no MP3 file was found in ${tempDir}. Files present: ${files.join(', ')}.`);
    }

    // --- 2. Prepare and Stream the MP3 File ---
    // (Streaming logic remains the same)
    const stats = fs.statSync(actualMp3Path);
    const dataStream = fs.createReadStream(actualMp3Path);
    const filenameForUser = path.basename(actualMp3Path);
    console.log(`Streaming MP3 file: ${actualMp3Path}, Size: ${stats.size}, Filename for user: ${filenameForUser}`);
    const fallbackFilename = 'downloaded_audio.mp3';
    const encodedFilename = encodeURIComponent(filenameForUser);
    const contentDispositionValue = `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`;
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
    // node-yt-dlp might throw specific errors or attach details
    let errorMessage = `Download failed: ${error.message}`;
    if (error.stderr) { // Check standard error properties
        errorMessage += `\nStderr: ${error.stderr.substring(0, 500)}`;
    }
    cleanupTempFiles(tempDir);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Helper function for cleanup
function cleanupTempFiles(folderPath) { /* ... same as before ... */
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
