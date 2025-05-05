// /app/api/download-playlist/route.js

// Fixes EROFS by using /tmp and ENOENT by using yt-dlp-exec.
// Uses adm-zip for creating the zip file.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip'; // Use adm-zip
import ytDlpExec from 'yt-dlp-exec'; // Use yt-dlp-exec

export async function POST(request) {
  console.log('--- DOWNLOAD PLAYLIST (ZIP - Fix EROFS/ENOENT) API ROUTE HIT ---');
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

    // --- 1. Download Playlist MP3s using yt-dlp-exec ---
    console.log(`Executing yt-dlp-exec to download playlist MP3s into ${folderPath}`);
    const outputPathTemplate = path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s');

    const ytDlpOutput = await ytDlpExec(playlistUrl, {
        extractAudio: true,
        audioFormat: 'mp3',
        output: outputPathTemplate,
        // Add playlist specific flags if needed (e.g., --playlist-items)
    });

    console.log('yt-dlp-exec playlist output:', ytDlpOutput);

    // --- 2. Check if files were downloaded ---
    const files = fs.readdirSync(folderPath);
    const mp3Files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
    console.log(`Files found in ${folderPath}:`, mp3Files);
    if (mp3Files.length === 0) {
        const stderrSnippet = ytDlpOutput?.stderr ? ytDlpOutput.stderr.substring(0, 500) : 'N/A';
        throw new Error(`yt-dlp did not download any MP3 files into ${folderPath}. Stderr: ${stderrSnippet}`);
    }

    // --- 3. Create Zip file using adm-zip ---
    console.log(`Attempting to zip folder: ${folderPath} into ${zipFilePath}`);
    const zip = new AdmZip();
    zip.addLocalFolder(folderPath); // Add contents of the temp folder
    console.log(`Attempting to write zip file: ${zipFilePath}`);
    zip.writeZip(zipFilePath); // Write zip file to /tmp
    console.log(`Zip file written: ${zipFilePath}`);

    // --- 4. Prepare and Stream the Zip File ---
    if (!fs.existsSync(zipFilePath)) {
        throw new Error(`Zip file was not found after writing: ${zipFilePath}`);
    }
    const stats = fs.statSync(zipFilePath);
    const dataStream = fs.createReadStream(zipFilePath);
    const filenameForUser = zipFileName; // Use the generated zip filename

    console.log(`Streaming Zip file: ${zipFilePath}, Size: ${stats.size}`);

    // Use ReadableStream for response and cleanup
    const responseStream = new ReadableStream({
        start(controller) {
            dataStream.on('data', (chunk) => controller.enqueue(chunk));
            dataStream.on('end', () => {
                console.log('Zip file stream ended.');
                controller.close();
                // Clean up BOTH the folder and the zip file
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
        // Filename encoding usually not needed for simple zip names, but can add if required
        'Content-Disposition': `attachment; filename="${filenameForUser}"`,
        'Content-Length': stats.size.toString(),
      },
    });

  } catch (error) {
    console.error("API /api/download-playlist final catch error:", error);
    let errorMessage = `Playlist download failed: ${error.message}`;
    if (error.stderr) {
        errorMessage += `\nStderr: ${error.stderr.substring(0, 500)}`;
    }
    // Clean up potentially partially created folder/zip
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
    }, 2000); // Increased delay slightly for zip operations
}

