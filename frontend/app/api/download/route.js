// /app/api/download/route.js

// Copies binary to /tmp, chmods it, then executes.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
// Import the library and its path helper
import youtubeDl from 'youtube-dl-exec';
import { youtubeDlPath as originalYtDlpPath } from 'youtube-dl-exec'; // Get original path

// --- Setup: Copy binary to /tmp and ensure permissions ---
let confirmedExecutablePath = null; // Path to the executable copy in /tmp
const tmpBinaryPath = path.join(os.tmpdir(), 'youtube-dl'); // Destination path in /tmp

try {
    console.log(`Original youtube-dl binary path: ${originalYtDlpPath}`);

    // 1. Check if original binary exists
    if (!originalYtDlpPath || !fs.existsSync(originalYtDlpPath)) {
        throw new Error(`Original binary path from youtube-dl-exec is invalid or file does not exist: ${originalYtDlpPath}`);
    }
    console.log(`Original binary found at: ${originalYtDlpPath}`);

    // 2. Copy binary to /tmp
    console.log(`Copying binary to: ${tmpBinaryPath}`);
    fs.copyFileSync(originalYtDlpPath, tmpBinaryPath);
    console.log(`Binary copied successfully.`);

    // 3. Set execute permissions on the copy in /tmp
    console.log(`Attempting chmod +x on the copy: ${tmpBinaryPath}`);
    fs.chmodSync(tmpBinaryPath, 0o755); // Set rwxr-xr-x permissions

    // 4. Verify execute permission on the copy in /tmp
    fs.accessSync(tmpBinaryPath, fs.constants.X_OK);
    console.log(`Execute permission confirmed for copy at: ${tmpBinaryPath}`);

    // 5. Store the confirmed path in /tmp
    confirmedExecutablePath = tmpBinaryPath;

} catch (err) {
    console.error(`CRITICAL Error setting up youtube-dl binary in /tmp: ${err.message}`);
    // Path remains null if setup fails
}
// --- End setup ---


export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (youtube-dl-exec copy/chmod) API ROUTE HIT ---');

  // Check if binary setup succeeded
  if (!confirmedExecutablePath) {
      console.error("youtube-dl binary could not be copied to /tmp or made executable.");
      return NextResponse.json({ error: "Server configuration error: youtube-dl setup failed." }, { status: 500 });
  }

  const { url } = await request.json();
  if (!url) {
    return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
  }

  const tempDir = path.join(os.tmpdir(), `single_dl_${Date.now()}`); // Separate temp dir for downloads
  let actualMp3Path = null;

  try {
    console.log(`Attempting to create download directory: ${tempDir}`);
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`Download directory created: ${tempDir}`);

    // --- 1. Download Single MP3 using youtube-dl-exec ---
    console.log(`Executing youtube-dl using binary at: ${confirmedExecutablePath}`);
    const outputTemplate = path.join(tempDir, '%(title)s.%(ext)s');

    // Execute using the library, passing the confirmed binary path IN /tmp
    const stdout = await youtubeDl(url, {
      extractAudio: true,         // -x
      audioFormat: 'mp3',         // --audio-format mp3
      output: outputTemplate,     // -o
    }, { // Pass execution options
        binaryPath: confirmedExecutablePath // Use the path in /tmp
    });
    console.log('youtube-dl-exec stdout:', stdout);


    // --- 2. Find and Stream File ---
    // (Rest of the logic remains the same)
    console.log(`Searching for MP3 file in ${tempDir}`);
    const files = fs.readdirSync(tempDir);
    const mp3File = files.find(f => f.toLowerCase().endsWith('.mp3'));
    if (!mp3File) {
        throw new Error(`youtube-dl finished, but no MP3 file was found in ${tempDir}. Files present: ${files.join(', ')}.`);
    }
    actualMp3Path = path.join(tempDir, mp3File);
    console.log(`Found downloaded MP3: ${actualMp3Path}`);
    const stats = fs.statSync(actualMp3Path);
    const dataStream = fs.createReadStream(actualMp3Path);
    const filenameForUser = path.basename(actualMp3Path);
    const fallbackFilename = 'downloaded_audio.mp3';
    const encodedFilename = encodeURIComponent(filenameForUser);
    const contentDispositionValue = `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`;
    const responseStream = new ReadableStream({ /* ... stream handling ... */
        start(controller) {
            dataStream.on('data', (chunk) => controller.enqueue(chunk));
            dataStream.on('end', () => { controller.close(); cleanupTempFiles(tempDir, confirmedExecutablePath); }); // Clean up download dir AND binary copy
            dataStream.on('error', (err) => { controller.error(err); cleanupTempFiles(tempDir, confirmedExecutablePath); });
        },
        cancel() { dataStream.destroy(); cleanupTempFiles(tempDir, confirmedExecutablePath); }
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
    cleanupTempFiles(tempDir, confirmedExecutablePath); // Clean up download dir AND binary copy
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Updated cleanup function to also remove the binary copy from /tmp
function cleanupTempFiles(downloadFolderPath, binaryTmpPath) {
     setTimeout(() => {
        // Clean up download folder
        try {
            if (downloadFolderPath && fs.existsSync(downloadFolderPath)) {
                console.log(`CLEANUP: Removing download folder: ${downloadFolderPath}`);
                fs.rmSync(downloadFolderPath, { recursive: true, force: true });
            }
        } catch (cleanupError) { console.error("CLEANUP (Download Folder) Error:", cleanupError); }

        // Clean up binary copy in /tmp
        try {
             if (binaryTmpPath && fs.existsSync(binaryTmpPath)) {
                 console.log(`CLEANUP: Removing binary copy: ${binaryTmpPath}`);
                 fs.unlinkSync(binaryTmpPath);
             }
         } catch (cleanupError) { console.error("CLEANUP (Binary Copy) Error:", cleanupError); }

    }, 1000);
}
