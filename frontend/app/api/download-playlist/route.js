// /app/api/download-playlist/route.js

// Uses execFile for yt-dlp, /tmp for paths, and adm-zip.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { execFile } from 'child_process'; // Use execFile
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
// Keep yt-dlp-exec installed for its binary, but find path manually
// import ytDlpExec from 'yt-dlp-exec'; // No longer calling the wrapper

// --- Find the yt-dlp binary path ---
let ytDlpPath;
try {
    const packagePath = require.resolve('yt-dlp-exec');
    const binPathGuess = path.join(path.dirname(packagePath), '../bin/yt-dlp');
    const binPathGuessExe = path.join(path.dirname(packagePath), '../bin/yt-dlp.exe');
    if (fs.existsSync(binPathGuess)) {
        ytDlpPath = binPathGuess;
    } else if (fs.existsSync(binPathGuessExe)) {
        ytDlpPath = binPathGuessExe;
    } else {
         const directPath = path.join(process.cwd(), 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
         const directPathExe = path.join(process.cwd(), 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe');
         if (fs.existsSync(directPath)) { ytDlpPath = directPath; }
         else if (fs.existsSync(directPathExe)) { ytDlpPath = directPathExe; }
         else { throw new Error('yt-dlp binary not found via require.resolve or direct path.'); }
    }
    console.log(`Found yt-dlp binary at: ${ytDlpPath}`);
} catch (err) {
    console.error("Error finding yt-dlp path:", err);
    ytDlpPath = null;
}
// --- End find binary path ---

export async function POST(request) {
  console.log('--- DOWNLOAD PLAYLIST (ZIP - execFile) API ROUTE HIT ---');

  // Check if ytDlpPath was found
  if (!ytDlpPath) {
      console.error("yt-dlp binary path could not be determined. Ensure 'yt-dlp-exec' is installed.");
      return NextResponse.json({ error: "Server configuration error: yt-dlp not found." }, { status: 500 });
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

    // --- 1. Download Playlist MP3s using execFile ---
    console.log(`Executing yt-dlp binary directly from: ${ytDlpPath}`);
    const outputPathTemplate = path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s');

    // Define arguments for execFile
    const args = [
        playlistUrl, // URL first
        '-x', // Extract audio
        '--audio-format', 'mp3', // Specify MP3 format
        '-o', outputPathTemplate // Output template
        // Add other playlist flags if needed
    ];
    console.log('yt-dlp execFile args:', args);

    // Execute using execFile
    await new Promise((resolve, reject) => {
        execFile(ytDlpPath, args, (error, stdout, stderr) => {
            if (stdout) console.log('yt-dlp stdout:\n', stdout);
            if (stderr) console.error('yt-dlp stderr:\n', stderr);
            if (error) {
                console.error(`yt-dlp execFile error: ${error.message}`);
                error.stderrContent = stderr;
                return reject(error);
            }
            console.log('yt-dlp execFile finished successfully.');
            resolve({ stdout, stderr });
        });
    });

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
    // (Streaming logic remains the same)
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
            dataStream.on('end', () => { controller.close(); cleanupTempFiles(folderPath, zipFilePath); });
            dataStream.on('error', (err) => { controller.error(err); cleanupTempFiles(folderPath, zipFilePath); });
        },
        cancel() { /* ... cancel handling ... */
             dataStream.destroy(); cleanupTempFiles(folderPath, zipFilePath);
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
    if (error.stderrContent) {
        errorMessage += `\nStderr: ${error.stderrContent.substring(0, 500)}`;
    }
    cleanupTempFiles(folderPath, zipFilePath);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Updated cleanup function for folder and zip file
function cleanupTempFiles(tempFolderPath, finalZipPath) {
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
        } catch (cleanupError) {
            console.error("CLEANUP: Error:", cleanupError);
        }
    }, 2000);
}
