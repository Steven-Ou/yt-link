// /app/api/download/route.js

// Uses youtube-dl-exec, ensures binary path and permissions.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
// Import the library and its path helper
import youtubeDl from 'youtube-dl-exec';
import { youtubeDlPath } from 'youtube-dl-exec'; // Import the path

// --- Ensure yt-dl binary path and permissions ---
let confirmedYtDlpPath = null;
try {
    console.log(`youtube-dl-exec provided path: ${youtubeDlPath}`);
    if (!youtubeDlPath || !fs.existsSync(youtubeDlPath)) {
        throw new Error(`Binary path from youtube-dl-exec is invalid or file does not exist: ${youtubeDlPath}`);
    }
    // Attempt to set execute permissions proactively
    console.log(`Attempting chmod +x on: ${youtubeDlPath}`);
    fs.chmodSync(youtubeDlPath, 0o755); // Set rwxr-xr-x permissions
    // Verify execute permission after chmod
    fs.accessSync(youtubeDlPath, fs.constants.X_OK);
    console.log(`Execute permission confirmed for: ${youtubeDlPath}`);
    confirmedYtDlpPath = youtubeDlPath; // Store the confirmed path
} catch (err) {
    console.error(`CRITICAL Error setting up youtube-dl binary: ${err.message}`);
    // Path remains null if setup fails
}
// --- End setup ---


export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (youtube-dl-exec + chmod) API ROUTE HIT ---');

  // Check if binary setup succeeded
  if (!confirmedYtDlpPath) {
      console.error("youtube-dl binary path could not be confirmed or made executable.");
      return NextResponse.json({ error: "Server configuration error: youtube-dl setup failed." }, { status: 500 });
  }

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
    console.log(`Executing youtube-dl with confirmed path: ${confirmedYtDlpPath}`);
    const outputTemplate = path.join(tempDir, '%(title)s.%(ext)s');

    // Execute using the library, passing the confirmed binary path
    const stdout = await youtubeDl(url, {
      extractAudio: true,         // -x
      audioFormat: 'mp3',         // --audio-format mp3
      output: outputTemplate,     // -o
    }, { // Pass execution options
        binaryPath: confirmedYtDlpPath // Use the path we confirmed/chmod-ed
    });
    console.log('youtube-dl-exec stdout:', stdout);


    // --- 2. Find and Stream File ---
    console.log(`Searching for MP3 file in ${tempDir}`);
    const files = fs.readdirSync(tempDir);
    const mp3File = files.find(f => f.toLowerCase().endsWith('.mp3'));
    if (!mp3File) {
        throw new Error(`youtube-dl finished, but no MP3 file was found in ${tempDir}. Files present: ${files.join(', ')}.`);
    }
    actualMp3Path = path.join(tempDir, mp3File);
    console.log(`Found downloaded MP3: ${actualMp3Path}`);

    // (Streaming logic remains the same)
    const stats = fs.statSync(actualMp3Path);
    const dataStream = fs.createReadStream(actualMp3Path);
    const filenameForUser = path.basename(actualMp3Path);
    const fallbackFilename = 'downloaded_audio.mp3';
    const encodedFilename = encodeURIComponent(filenameForUser);
    const contentDispositionValue = `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`;
    const responseStream = new ReadableStream({ /* ... stream handling ... */
        start(controller) {
            dataStream.on('data', (chunk) => controller.enqueue(chunk));
            dataStream.on('end', () => { controller.close(); cleanupTempFiles(tempDir); });
            dataStream.on('error', (err) => { controller.error(err); cleanupTempFiles(tempDir); });
        },
        cancel() { dataStream.destroy(); cleanupTempFiles(tempDir); }
    });
    return new NextResponse(responseStream, { status: 200, headers: { /* ... headers ... */
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': contentDispositionValue,
        'Content-Length': stats.size.toString(),
     } });

  } catch (error) {
    console.error('API /api/download final catch error:', error);
    let errorMessage = `Download failed: ${error.message}`;
    if (error.stderr) { errorMessage += `\nStderr: ${error.stderr.substring(0, 500)}`; }
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
        } catch (cleanupError) { console.error("CLEANUP: Error:", cleanupError); }
    }, 1000);
}
