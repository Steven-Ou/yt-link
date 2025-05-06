// /app/api/download/route.js

// Manually finds binary in node_modules, copies to /tmp, chmods it, then executes.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
// Import only the main execution function from the library
import youtubeDl from 'youtube-dl-exec';
// DO NOT import { youtubeDlPath } - we will find it manually

// --- Setup: Find binary manually, copy to /tmp, ensure permissions ---
let confirmedExecutablePath = null; // Path to the executable copy in /tmp
const tmpBinaryName = `youtube-dl_${Date.now()}`; // Unique name in tmp
const tmpBinaryPath = path.join(os.tmpdir(), tmpBinaryName);

console.log("--- Starting youtube-dl binary setup ---");
try {
    // Try finding the original path relative to node_modules
    // This is often more reliable in bundled environments than require.resolve
    // Adjust these paths based on the ACTUAL structure within node_modules/youtube-dl-exec
    // Common locations are ./bin/youtube-dl or ./dist/yt-dlp or similar
    const possiblePath1 = path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', 'youtube-dl');
    const possiblePath2 = path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', 'youtube-dl.exe'); // Windows fallback
    const possiblePath3 = path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'dist', 'yt-dlp'); // Sometimes it uses yt-dlp internally
    const possiblePath4 = path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'dist', 'yt-dlp.exe'); // Windows fallback

    let originalYtDlpPath = null;
    const searchPaths = [possiblePath1, possiblePath2, possiblePath3, possiblePath4]; // Add more potential paths if needed
    console.log("Searching for original binary manually in paths:", searchPaths);

    for (const p of searchPaths) {
        if (fs.existsSync(p)) {
            originalYtDlpPath = p;
            console.log(`Found original binary at: ${originalYtDlpPath}`);
            break; // Stop searching once found
        }
    }

    if (!originalYtDlpPath) {
         // Log contents of node_modules/youtube-dl-exec if possible for debugging
         try {
             const pkgDir = path.join(process.cwd(), 'node_modules', 'youtube-dl-exec');
             console.error(`Contents of ${pkgDir}:`, fs.readdirSync(pkgDir, { withFileTypes: true }));
             const binDir = path.join(pkgDir, 'bin');
             if (fs.existsSync(binDir)) { console.error(`Contents of ${binDir}:`, fs.readdirSync(binDir)); }
              const distDir = path.join(pkgDir, 'dist');
             if (fs.existsSync(distDir)) { console.error(`Contents of ${distDir}:`, fs.readdirSync(distDir)); }
         } catch (e) { console.error("Could not list node_modules/youtube-dl-exec contents for debugging."); }
        throw new Error(`Could not find original binary in expected node_modules paths.`);
    }

    // Copy binary to /tmp
    console.log(`Copying binary from ${originalYtDlpPath} to: ${tmpBinaryPath}`);
    fs.copyFileSync(originalYtDlpPath, tmpBinaryPath);
    console.log(`Binary copied successfully.`);

    // Set execute permissions on the copy in /tmp
    console.log(`Attempting chmod +x on the copy: ${tmpBinaryPath}`);
    fs.chmodSync(tmpBinaryPath, 0o755);

    // Verify execute permission on the copy in /tmp
    fs.accessSync(tmpBinaryPath, fs.constants.X_OK);
    console.log(`Execute permission confirmed for copy at: ${tmpBinaryPath}`);

    // Store the confirmed path in /tmp
    confirmedExecutablePath = tmpBinaryPath;
    console.log("--- youtube-dl binary setup successful ---");

} catch (err) {
    console.error(`CRITICAL Error setting up youtube-dl binary in /tmp: ${err.message}`);
    // Path remains null if setup fails
    console.log("--- youtube-dl binary setup FAILED ---");
}
// --- End setup ---


export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (Manual Path + copy/chmod) API ROUTE HIT ---');

  // Check if binary setup succeeded
  if (!confirmedExecutablePath) {
      console.error("youtube-dl binary could not be prepared in /tmp.");
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
      extractAudio: true,
      audioFormat: 'mp3',
      output: outputTemplate,
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
