// /app/api/download-playlist/route.js

// Uses youtube-dl-exec, /tmp for paths, and adm-zip.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
// Import the new package
import youtubeDlExec from 'youtube-dl-exec';

// No need to manually find the path anymore

export async function POST(request) {
  console.log('--- DOWNLOAD PLAYLIST (ZIP - youtube-dl-exec) API ROUTE HIT ---');
  const { playlistUrl } = await request.json();
  if (!playlistUrl) {
    return NextResponse.json({ error: 'No playlist URL provided' }, { status: 400 });
  }

  // Use /tmp directory
  const baseTempDir = os.tmpdir();
  const uniqueFolderName = `playlist_${Date.now()}`;
  const folderPath = path.join(baseTempDir, uniqueFolderName); // Download folder inside /tmp
  const zipFileName = `${uniqueFolderName}.zip`;
  const zipFilePath = path.join(baseTempDir, zipFileName); // Zip file also inside /tmp

  try {
    console.log(`Attempting to create temporary directory: ${folderPath}`);
    fs.mkdirSync(folderPath, { recursive: true });
    console.log(`Temporary directory created: ${folderPath}`);

    // --- 1. Download Playlist MP3s using youtube-dl-exec ---
    console.log(`Executing youtube-dl-exec to download playlist MP3s into ${folderPath}`);
    const outputPathTemplate = path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s');

    // Execute using the library
    const stdout = await youtubeDlExec(playlistUrl, {
        extractAudio: true,         // -x
        audioFormat: 'mp3',         // --audio-format mp3
        output: outputPathTemplate, // -o
        // Add playlist specific flags if needed
    });

    console.log('youtube-dl-exec playlist stdout:', stdout);

    // --- 2. Check if files were downloaded ---
    const files = fs.readdirSync(folderPath);
    const mp3Files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
    console.log(`Files found in ${folderPath}:`, mp3Files);
    if (mp3Files.length === 0) {
        // Try to get more info from potential error object if library throws one
        throw new Error(`youtube-dl did not download any MP3 files into ${folderPath}.`);
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

    // Use ReadableStream for response and cleanup
    const responseStream = new ReadableStream({
        start(controller) {
            dataStream.on('data', (chunk) => controller.enqueue(chunk));
            dataStream.on('end', () => {
                console.log('Zip file stream ended.');
                controller.close();
                cleanupTempFiles(folderPath, zipFilePath);
            });
            dataStream.on('error', (err) => {
                console.error('Zip file stream error:', err);
                controller.error(err);
                cleanupTempFiles(folderPath, zipFilePath);
            });
        },
        cancel() {
            console.log('Zip file stream cancelled.');
            dataStream.destroy();
            cleanupTempFiles(folderPath, zipFilePath);
        }
    });

    return new NextResponse(responseStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filenameForUser}"`,
        'Content-Length': stats.size.toString(),
      },
    });

  } catch (error) {
    console.error("API /api/download-playlist final catch error:", error);
    let errorMessage = `Playlist download failed: ${error.message}`;
    if (error.stderr) { // Check if error object has stderr
        errorMessage += `\nStderr: ${error.stderr.substring(0, 500)}`;
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
