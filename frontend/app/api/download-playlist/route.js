// /app/api/download-playlist/route.js

// Uses youtube-dl-exec, ensures binary path/permissions, uses /tmp, uses adm-zip.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
// Import the library and its path helper
import youtubeDl from 'youtube-dl-exec';
import { youtubeDlPath } from 'youtube-dl-exec';

// --- Ensure yt-dl binary path and permissions ---
let confirmedYtDlpPath = null;
try {
    console.log(`youtube-dl-exec provided path: ${youtubeDlPath}`);
    if (!youtubeDlPath || !fs.existsSync(youtubeDlPath)) {
        throw new Error(`Binary path from youtube-dl-exec is invalid or file does not exist: ${youtubeDlPath}`);
    }
    console.log(`Attempting chmod +x on: ${youtubeDlPath}`);
    fs.chmodSync(youtubeDlPath, 0o755);
    fs.accessSync(youtubeDlPath, fs.constants.X_OK);
    console.log(`Execute permission confirmed for: ${youtubeDlPath}`);
    confirmedYtDlpPath = youtubeDlPath;
} catch (err) {
    console.error(`CRITICAL Error setting up youtube-dl binary: ${err.message}`);
}
// --- End setup ---


export async function POST(request) {
  console.log('--- DOWNLOAD PLAYLIST (ZIP - youtube-dl-exec + chmod) API ROUTE HIT ---');

  // Check if binary setup succeeded
  if (!confirmedYtDlpPath) {
      console.error("youtube-dl binary path could not be confirmed or made executable.");
      return NextResponse.json({ error: "Server configuration error: youtube-dl setup failed." }, { status: 500 });
  }

  const { playlistUrl } = await request.json();
  if (!playlistUrl) {
    return NextResponse.json({ error: 'No playlist URL provided' }, { status: 400 });
  }

  const baseTempDir = os.tmpdir();
  const uniqueFolderName = `playlist_${Date.now()}`;
  const folderPath = path.join(baseTempDir, uniqueFolderName);
  const zipFileName = `${uniqueFolderName}.zip`;
  const zipFilePath = path.join(baseTempDir, zipFileName);

  try {
    console.log(`Attempting to create temporary directory: ${folderPath}`);
    fs.mkdirSync(folderPath, { recursive: true });
    console.log(`Temporary directory created: ${folderPath}`);

    // --- 1. Download Playlist MP3s using youtube-dl-exec ---
    console.log(`Executing youtube-dl with confirmed path: ${confirmedYtDlpPath}`);
    const outputPathTemplate = path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s');

    // Execute using the library, passing the confirmed binary path
    const stdout = await youtubeDl(playlistUrl, {
        extractAudio: true,
        audioFormat: 'mp3',
        output: outputPathTemplate,
    }, { // Pass execution options
        binaryPath: confirmedYtDlpPath
    });
    console.log('youtube-dl-exec playlist stdout:', stdout);


    // --- 2. Check files and Zip ---
    const files = fs.readdirSync(folderPath);
    const mp3Files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
    if (mp3Files.length === 0) {
        throw new Error(`youtube-dl did not download any MP3 files into ${folderPath}.`);
    }
    console.log(`Found ${mp3Files.length} MP3 files. Zipping...`);
    const zip = new AdmZip();
    zip.addLocalFolder(folderPath);
    zip.writeZip(zipFilePath);
    console.log(`Zip file written: ${zipFilePath}`);

    // --- 3. Prepare and Stream the Zip File ---
    // (Streaming logic remains the same)
    if (!fs.existsSync(zipFilePath)) { throw new Error(`Zip file was not found: ${zipFilePath}`); }
    const stats = fs.statSync(zipFilePath);
    const dataStream = fs.createReadStream(zipFilePath);
    const filenameForUser = zipFileName;
    console.log(`Streaming Zip file: ${zipFilePath}, Size: ${stats.size}`);
    const responseStream = new ReadableStream({
        start(controller) { /* ... stream handling ... */
            dataStream.on('data', (chunk) => controller.enqueue(chunk));
            dataStream.on('end', () => { controller.close(); cleanupTempFiles(folderPath, zipFilePath); });
            dataStream.on('error', (err) => { controller.error(err); cleanupTempFiles(folderPath, zipFilePath); });
        },
        cancel() { /* ... cancel handling ... */
             dataStream.destroy(); cleanupTempFiles(folderPath, zipFilePath);
        }
    });
    return new NextResponse(responseStream, { status: 200, headers: { /* ... headers ... */
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filenameForUser}"`,
        'Content-Length': stats.size.toString(),
     } });

  } catch (error) {
    console.error("API /api/download-playlist final catch error:", error);
    let errorMessage = `Playlist download failed: ${error.message}`;
    if (error.stderr) { errorMessage += `\nStderr: ${error.stderr.substring(0, 500)}`; }
    cleanupTempFiles(folderPath, zipFilePath);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Updated cleanup function for folder and zip file
function cleanupTempFiles(tempFolderPath, finalZipPath) { /* ... same as before ... */
     setTimeout(() => {
        try {
            if (tempFolderPath && fs.existsSync(tempFolderPath)) {
                console.log(`CLEANUP: Removing folder: ${tempFolderPath}`);
                fs.rmSync(tempFolderPath, { recursive: true, force: true });
            }
            if (finalZipPath && fs.existsSync(finalZipPath)) {
                console.log(`CLEANUP: Removing zip file: ${finalZipPath}`);
                fs.unlinkSync(finalZipPath);
            }
        } catch (cleanupError) { console.error("CLEANUP: Error:", cleanupError); }
    }, 2000);
}
