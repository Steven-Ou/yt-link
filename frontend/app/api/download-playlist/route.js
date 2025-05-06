// /app/api/download-playlist/route.js

// Uses bundled yt-dlp binary copied to /tmp, uses /tmp for downloads, uses adm-zip.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { spawn } from 'child_process'; // Use spawn
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
// No youtube-dl/yt-dlp library imports needed

// --- Setup: Locate bundled binary, copy to /tmp, ensure permissions ---
let confirmedExecutablePath = null; // Path to the executable copy in /tmp
const bundledBinaryName = 'yt-dlp'; // Name of the file in ./bin
const tmpBinaryPath = path.join(os.tmpdir(), `yt-dlp_${Date.now()}`); // Unique path in /tmp

console.log("--- Starting bundled yt-dlp binary setup ---");
try {
    const originalBinaryPath = path.join(process.cwd(), 'bin', bundledBinaryName);
    console.log(`Attempting to locate bundled binary at: ${originalBinaryPath}`);
    if (!fs.existsSync(originalBinaryPath)) {
        try {
             console.error(`Contents of ${process.cwd()}:`, fs.readdirSync(process.cwd()));
             const binDir = path.join(process.cwd(), 'bin');
             if (fs.existsSync(binDir)) { console.error(`Contents of ${binDir}:`, fs.readdirSync(binDir)); }
         } catch (e) { console.error("Could not list directories for debugging."); }
        throw new Error(`Bundled binary not found at expected path: ${originalBinaryPath}. Ensure bin/yt-dlp is included in deployment.`);
    }
    console.log(`Bundled binary found at: ${originalBinaryPath}`);
    console.log(`Copying binary to: ${tmpBinaryPath}`);
    fs.copyFileSync(originalBinaryPath, tmpBinaryPath);
    console.log(`Binary copied successfully.`);
    console.log(`Attempting chmod +x on the copy: ${tmpBinaryPath}`);
    fs.chmodSync(tmpBinaryPath, 0o755);
    fs.accessSync(tmpBinaryPath, fs.constants.X_OK);
    console.log(`Execute permission confirmed for copy at: ${tmpBinaryPath}`);
    confirmedExecutablePath = tmpBinaryPath;
    console.log("--- Bundled yt-dlp binary setup successful ---");
} catch (err) {
    console.error(`CRITICAL Error setting up bundled yt-dlp binary in /tmp: ${err.message}`);
    console.log("--- Bundled yt-dlp binary setup FAILED ---");
}
// --- End setup ---


export async function POST(request) {
  console.log('--- DOWNLOAD PLAYLIST (ZIP - Bundled Binary) API ROUTE HIT ---');

  // Check if binary setup succeeded
  if (!confirmedExecutablePath) {
      console.error("Bundled yt-dlp binary could not be prepared in /tmp.");
      return NextResponse.json({ error: "Server configuration error: yt-dlp setup failed." }, { status: 500 });
  }

  const { playlistUrl } = await request.json();
  if (!playlistUrl) {
    return NextResponse.json({ error: 'No playlist URL provided' }, { status: 400 });
  }

  const baseTempDir = os.tmpdir();
  const uniqueFolderName = `playlist_${Date.now()}`;
  const folderPath = path.join(baseTempDir, uniqueFolderName); // Download folder inside /tmp
  const zipFileName = `${uniqueFolderName}.zip`;
  const zipFilePath = path.join(baseTempDir, zipFileName); // Zip file also inside /tmp

  try {
    console.log(`Attempting to create download directory: ${folderPath}`);
    fs.mkdirSync(folderPath, { recursive: true });
    console.log(`Download directory created: ${folderPath}`);

    // --- 1. Download Playlist MP3s using spawn with the bundled binary ---
    console.log(`Spawning yt-dlp process using binary at: ${confirmedExecutablePath}`);
    const outputPathTemplate = path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s');

    // Define arguments for spawn
    const args = [
        playlistUrl,
        '-x', // Extract audio
        '--audio-format', 'mp3',
        '-o', outputPathTemplate
        // Add other playlist flags if needed
    ];
    console.log('yt-dlp spawn args:', args);

    // Execute using spawn
    await new Promise((resolve, reject) => {
        const ytDlpProcess = spawn(confirmedExecutablePath, args, { shell: false });
        let stderrData = '';
        ytDlpProcess.stderr.on('data', (data) => { console.error(`yt-dlp stderr: ${data}`); stderrData += data.toString(); });
        ytDlpProcess.on('error', (spawnError) => reject(new Error(`Failed to start yt-dlp: ${spawnError.message}`)));
        ytDlpProcess.on('close', (code) => {
            console.log(`yt-dlp process exited with code ${code}`);
            if (code === 0) { resolve(); }
            else { reject(new Error(`yt-dlp failed with exit code ${code}. Stderr snippet: ${stderrData.substring(0, 500)}...`)); }
        });
    });
    console.log('yt-dlp playlist download finished.');

    // --- 2. Check if files were downloaded ---
    const files = fs.readdirSync(folderPath);
    const mp3Files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
    console.log(`Files found in ${folderPath}:`, mp3Files);
    if (mp3Files.length === 0) {
        throw new Error(`yt-dlp did not download any MP3 files into ${folderPath}.`);
    }

    // --- 3. Create Zip file using adm-zip ---
    console.log(`Attempting to zip folder: ${folderPath} into ${zipFilePath}`);
    const zip = new AdmZip();
    zip.addLocalFolder(folderPath);
    console.log(`Attempting to write zip file: ${zipFilePath}`);
    zip.writeZip(zipFilePath);
    console.log(`Zip file written: ${zipFilePath}`);

    // --- 4. Prepare and Stream the Zip File ---
    if (!fs.existsSync(zipFilePath)) {
        throw new Error(`Zip file was not found after writing: ${zipFilePath}`);
    }
    const stats = fs.statSync(zipFilePath);
    const dataStream = fs.createReadStream(zipFilePath);
    const filenameForUser = zipFileName;
    console.log(`Streaming Zip file: ${zipFilePath}, Size: ${stats.size}`);
    const responseStream = new ReadableStream({
        start(controller) { /* ... stream handling ... */
            dataStream.on('data', (chunk) => controller.enqueue(chunk));
            dataStream.on('end', () => { controller.close(); cleanupTempFiles(folderPath, zipFilePath, confirmedExecutablePath); }); // Clean up download dir, zip, AND binary copy
            dataStream.on('error', (err) => { controller.error(err); cleanupTempFiles(folderPath, zipFilePath, confirmedExecutablePath); });
        },
        cancel() { /* ... cancel handling ... */
             dataStream.destroy(); cleanupTempFiles(folderPath, zipFilePath, confirmedExecutablePath);
        }
    });
    return new NextResponse(responseStream, {
      status: 200,
      headers: { /* ... headers ... */
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filenameForUser}"`,
        'Content-Length': stats.size.toString(),
       },
    });

  } catch (error) {
    console.error("API /api/download-playlist final catch error:", error);
    let errorMessage = `Playlist download failed: ${error.message}`;
    if (error.message.includes('Stderr snippet:')) {
        errorMessage = error.message; // Keep the message with stderr
    }
    cleanupTempFiles(folderPath, zipFilePath, confirmedExecutablePath); // Clean up download dir, zip, AND binary copy
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Updated cleanup function for folder, zip file, and binary copy
function cleanupTempFiles(tempFolderPath, finalZipPath, binaryTmpPath) {
     setTimeout(() => {
        try {
            if (tempFolderPath && fs.existsSync(tempFolderPath)) {
                console.log(`CLEANUP: Removing folder: ${tempFolderPath}`);
                fs.rmSync(tempFolderPath, { recursive: true, force: true });
            }
        } catch (cleanupError) { console.error("CLEANUP (Download Folder) Error:", cleanupError); }
        try {
            if (finalZipPath && fs.existsSync(finalZipPath)) {
                console.log(`CLEANUP: Removing zip file: ${finalZipPath}`);
                fs.unlinkSync(finalZipPath);
            }
        } catch (cleanupError) { console.error("CLEANUP (Zip File) Error:", cleanupError); }
        try {
             if (binaryTmpPath && fs.existsSync(binaryTmpPath)) {
                 console.log(`CLEANUP: Removing binary copy: ${binaryTmpPath}`);
                 fs.unlinkSync(binaryTmpPath);
             }
         } catch (cleanupError) { console.error("CLEANUP (Binary Copy) Error:", cleanupError); }
    }, 2000);
}
