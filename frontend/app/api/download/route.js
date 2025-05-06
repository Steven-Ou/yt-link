// /app/api/download/route.js

// Use youtube-dl-exec package
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
// Removed: import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
// Import the new package
import youtubeDlExec from 'youtube-dl-exec';

// No need to manually find the path anymore, let the library handle it.

export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (youtube-dl-exec) API ROUTE HIT ---');

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

    // --- 1. Download Single MP3 using youtube-dl-exec ---
    console.log(`Executing youtube-dl-exec to download and convert`);

    // Define output path template using video title
    const outputTemplate = path.join(tempDir, '%(title)s.%(ext)s');

    // Execute using the library - options are similar
    // It returns a promise that resolves with stdout
    const stdout = await youtubeDlExec(url, {
      extractAudio: true,         // -x
      audioFormat: 'mp3',         // --audio-format mp3
      output: outputTemplate,     // -o
      // Add any other necessary flags here
    });

    console.log('youtube-dl-exec stdout:', stdout); // Log stdout

    // Find the downloaded MP3 file (as filename is dynamic)
    console.log(`Searching for MP3 file in ${tempDir}`);
    const files = fs.readdirSync(tempDir);
    const mp3File = files.find(f => f.toLowerCase().endsWith('.mp3'));

    if (mp3File) {
        actualMp3Path = path.join(tempDir, mp3File);
        console.log(`Found downloaded MP3: ${actualMp3Path}`);
    } else {
        // youtube-dl-exec might throw an error with stderr attached
        throw new Error(`youtube-dl finished, but no MP3 file was found in ${tempDir}. Files present: ${files.join(', ')}.`);
    }

    console.log('MP3 download and conversion finished.');

    // --- 2. Prepare and Stream the MP3 File ---
    // (Rest of the streaming logic remains the same)
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
    // Catch errors from youtubeDlExec or fs operations
    console.error('API /api/download final catch error:', error);
    let errorMessage = `Download failed: ${error.message}`;
    if (error.stderr) { // Check if the error object has stderr attached by the library
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
