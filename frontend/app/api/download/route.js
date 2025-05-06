// /app/api/download/route.js

// Uses bundled yt-dlp binary copied to /tmp.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { spawn } from 'child_process'; // Use spawn
import fs from 'fs';
import path from 'path';
import os from 'os';
// No youtube-dl/yt-dlp library imports needed

// --- Setup: Locate bundled binary, copy to /tmp, ensure permissions ---
let confirmedExecutablePath = null; // Path to the executable copy in /tmp
const bundledBinaryName = 'yt-dlp'; // Name of the file in ./bin
const tmpBinaryPath = path.join(os.tmpdir(), `yt-dlp_${Date.now()}`); // Unique path in /tmp

console.log("--- Starting bundled yt-dlp binary setup ---");
try {
    // 1. Construct path to the bundled binary relative to current working directory
    // process.cwd() should be the root of the function code on Vercel
    const originalBinaryPath = path.join(process.cwd(), 'bin', bundledBinaryName);
    console.log(`Attempting to locate bundled binary at: ${originalBinaryPath}`);

    // 2. Check if bundled binary exists
    if (!fs.existsSync(originalBinaryPath)) {
        // Log directory contents for debugging if not found
         try {
             console.error(`Contents of ${process.cwd()}:`, fs.readdirSync(process.cwd()));
             const binDir = path.join(process.cwd(), 'bin');
             if (fs.existsSync(binDir)) { console.error(`Contents of ${binDir}:`, fs.readdirSync(binDir)); }
         } catch (e) { console.error("Could not list directories for debugging."); }
        throw new Error(`Bundled binary not found at expected path: ${originalBinaryPath}. Ensure bin/yt-dlp is included in deployment.`);
    }
    console.log(`Bundled binary found at: ${originalBinaryPath}`);

    // 3. Copy binary to /tmp
    console.log(`Copying binary to: ${tmpBinaryPath}`);
    fs.copyFileSync(originalBinaryPath, tmpBinaryPath);
    console.log(`Binary copied successfully.`);

    // 4. Set execute permissions on the copy in /tmp
    console.log(`Attempting chmod +x on the copy: ${tmpBinaryPath}`);
    fs.chmodSync(tmpBinaryPath, 0o755); // Set rwxr-xr-x permissions

    // 5. Verify execute permission on the copy in /tmp
    fs.accessSync(tmpBinaryPath, fs.constants.X_OK);
    console.log(`Execute permission confirmed for copy at: ${tmpBinaryPath}`);

    // 6. Store the confirmed path in /tmp
    confirmedExecutablePath = tmpBinaryPath;
    console.log("--- Bundled yt-dlp binary setup successful ---");

} catch (err) {
    console.error(`CRITICAL Error setting up bundled yt-dlp binary in /tmp: ${err.message}`);
    // Path remains null if setup fails
    console.log("--- Bundled yt-dlp binary setup FAILED ---");
}
// --- End setup ---


export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (Bundled Binary) API ROUTE HIT ---');

  // Check if binary setup succeeded
  if (!confirmedExecutablePath) {
      console.error("Bundled yt-dlp binary could not be prepared in /tmp.");
      return NextResponse.json({ error: "Server configuration error: yt-dlp setup failed." }, { status: 500 });
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

    // --- 1. Download Single MP3 using spawn with the bundled binary ---
    console.log(`Spawning yt-dlp process using binary at: ${confirmedExecutablePath}`);
    const outputTemplate = path.join(tempDir, '%(title)s.%(ext)s');

    // Define arguments for spawn
    const args = [
        url,
        '-x', // Extract audio
        '--audio-format', 'mp3',
        '-o', outputTemplate
    ];
    console.log('yt-dlp spawn args:', args);

    // Execute using spawn
    await new Promise((resolve, reject) => {
        const ytDlpProcess = spawn(confirmedExecutablePath, args, { shell: false }); // Use spawn
        let stderrData = '';

        // No need to capture stdout unless debugging specific output
        // ytDlpProcess.stdout.on('data', (data) => { console.log(`yt-dlp stdout: ${data}`); });

        ytDlpProcess.stderr.on('data', (data) => {
            console.error(`yt-dlp stderr: ${data}`);
            stderrData += data.toString();
        });
        ytDlpProcess.on('error', (spawnError) => {
            // This catches errors spawning the process itself (e.g., path incorrect - unlikely now)
            console.error(`Failed to start yt-dlp process: ${spawnError.message}`);
            reject(new Error(`Failed to start yt-dlp: ${spawnError.message}`));
        });
        ytDlpProcess.on('close', (code) => {
            console.log(`yt-dlp process exited with code ${code}`);
            if (code === 0) {
                console.log('yt-dlp finished successfully.');
                resolve(); // Success!
            } else {
                // yt-dlp exited with an error code
                console.error(`yt-dlp exited with error code ${code}. Check stderr.`);
                reject(new Error(`yt-dlp failed with exit code ${code}. Stderr snippet: ${stderrData.substring(0, 500)}...`));
            }
        });
    });

    // --- 2. Find and Stream File ---
    // (Rest of the logic remains the same)
    console.log(`Searching for MP3 file in ${tempDir}`);
    const files = fs.readdirSync(tempDir);
    const mp3File = files.find(f => f.toLowerCase().endsWith('.mp3'));
    if (!mp3File) {
        throw new Error(`yt-dlp finished, but no MP3 file was found in ${tempDir}. Files present: ${files.join(', ')}.`);
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
    // Add stderr if present from the promise rejection
    if (error.message.includes('Stderr snippet:')) {
        errorMessage = error.message; // Keep the message with stderr
    }
    cleanupTempFiles(tempDir, confirmedExecutablePath); // Clean up download dir AND binary copy
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Updated cleanup function to also remove the binary copy from /tmp
function cleanupTempFiles(downloadFolderPath, binaryTmpPath) { /* ... same as before ... */
     setTimeout(() => {
        try {
            if (downloadFolderPath && fs.existsSync(downloadFolderPath)) {
                console.log(`CLEANUP: Removing download folder: ${downloadFolderPath}`);
                fs.rmSync(downloadFolderPath, { recursive: true, force: true });
            }
        } catch (cleanupError) { console.error("CLEANUP (Download Folder) Error:", cleanupError); }
        try {
             if (binaryTmpPath && fs.existsSync(binaryTmpPath)) {
                 console.log(`CLEANUP: Removing binary copy: ${binaryTmpPath}`);
                 fs.unlinkSync(binaryTmpPath);
             }
         } catch (cleanupError) { console.error("CLEANUP (Binary Copy) Error:", cleanupError); }
    }, 1000);
}
