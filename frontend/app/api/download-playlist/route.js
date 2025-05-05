export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
// Remove: import { exec } from 'child_process';
import { spawn } from 'child_process'; // <--- Import spawn here
// Remove: import { promisify } from 'util';
// Remove: const execPromise = promisify(exec);

export async function POST(request) {
  console.log('--- DOWNLOAD PLAYLIST API ROUTE HIT ---');
  let folder;
  let filePath;

  try {
    const { playlistUrl } = await request.json();
    if (!playlistUrl) {
      return NextResponse.json({ error: 'No playlist URL provided' }, { status: 400 });
    }
    console.log(`Received playlist URL: ${playlistUrl}`);

    folder = `playlist_${Date.now()}`;
    const folderPath = path.resolve(folder);
    console.log(`Attempting to create directory: ${folderPath}`);
    fs.mkdirSync(folderPath);
    console.log(`Directory created: ${folderPath}`);

    // --- Define output for yt-dlp ---
    const outputTemplate = path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s'); // Use .%(ext)s
    // Remove: const command = ... (old exec command)

    // --- Execute yt-dlp using spawn ---
    console.log(`Spawning command: yt-dlp`);

    // Define arguments for spawn
    const args = [
        '-x',                           // Extract audio
        '--audio-format', 'mp3',        // Convert to mp3
        // IMPORTANT: Change output template to include extension placeholder .%(ext)s
        // yt-dlp handles intermediate files; let it name the final mp3 correctly.
        '-o', path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s'),
       // '--verbose', // Consider removing verbose for less output unless debugging
        playlistUrl                     // The playlist URL
    ];

    console.log('yt-dlp args:', args);

    // *** Start of the CORRECTED spawn block ***
    await new Promise((resolve, reject) => { // THIS is the promise we await
        const ytDlpProcess = spawn('yt-dlp', args, {
            shell: false
        });

        let stderrOutput = '';

        ytDlpProcess.stdout.on('data', (data) => {
             // Optional: log progress minimally
             // process.stdout.write('.'); // Example: print dots for progress
        });

        ytDlpProcess.stderr.on('data', (data) => {
            console.error(`yt-dlp stderr: ${data}`);
            stderrOutput += data.toString();
        });

        ytDlpProcess.on('error', (spawnError) => {
            console.error(`Failed to start yt-dlp process: ${spawnError.message}`);
            reject(new Error(`Failed to start yt-dlp: ${spawnError.message}`));
        });

        ytDlpProcess.on('close', (code) => {
            console.log(`yt-dlp process exited with code ${code}`);
            if (code === 0) {
                console.log('yt-dlp finished successfully.');
                resolve(); // Success!
            } else {
                console.error(`yt-dlp exited with error code ${code}. Check stderr.`);
                const shortStderr = stderrOutput.substring(0, 500);
                reject(new Error(`yt-dlp failed with exit code ${code}. Stderr snippet: ${shortStderr}...`));
            }
        });
    });
    // *** End of the CORRECTED spawn block ***

    console.log(`Proceeding after yt-dlp spawn execution.`);

    // --- Check, Zip, and Respond (Your existing logic) ---
    const files = fs.readdirSync(folderPath);
    console.log(`Files found in ${folderPath}:`, files);
    if (files.length === 0) {
        console.error(`No files downloaded by yt-dlp into ${folderPath}. Aborting zip.`);
        // Make sure folder is cleaned up even if empty
        throw new Error('yt-dlp did not download any files.');
    }

    // Filter for expected .mp3 files (optional but good practice)
    const mp3Files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
    if (mp3Files.length === 0) {
        console.error(`No MP3 files found in ${folderPath} after yt-dlp run. Files present: ${files.join(', ')}`);
        throw new Error('yt-dlp completed, but no MP3 files were found.');
    }
    console.log(`MP3 files to be zipped:`, mp3Files);


    const zip = new AdmZip();
    const outputFile = `${folder}.zip`;
    filePath = path.resolve(outputFile);
    console.log(`Attempting to zip folder: ${folderPath} into ${filePath}`);
    zip.addLocalFolder(folderPath); // Add contents of the folder
    console.log(`Attempting to write zip file: ${filePath}`);
    zip.writeZip(filePath);
    console.log(`Zip file should be written: ${filePath}`);

    console.log(`Checking for zip file existence at: ${filePath}`);
    const stats = fs.statSync(filePath);
    console.log(`Zip file found, size: ${stats.size}. Creating read stream.`);
    const data = fs.createReadStream(filePath);

    const response = new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`,
        'Content-Type': 'application/zip',
        'Content-Length': stats.size.toString(),
      },
    });
    return response;

  } catch (error) {
    console.error("API /api/download-playlist final catch error:", error);
    return NextResponse.json({ error: `Playlist download failed: ${error.message}` }, { status: 500 });
  } finally {
     // Ensure cleanup runs
     setTimeout(() => {
        try {
            const folderPathToDelete = folder ? path.resolve(folder) : null;
            const zipFilePathToDelete = filePath ? path.resolve(filePath) : null;

            if (folderPathToDelete && fs.existsSync(folderPathToDelete)) {
                console.log(`FINALLY: Cleaning up folder: ${folderPathToDelete}`);
                fs.rmSync(folderPathToDelete, { recursive: true, force: true });
            } else if (folder) {
                 console.log(`FINALLY: Folder already deleted or never created: ${folderPathToDelete}`);
            }

            if (zipFilePathToDelete && fs.existsSync(zipFilePathToDelete)) {
                console.log(`FINALLY: Cleaning up file: ${zipFilePathToDelete}`);
                fs.unlinkSync(zipFilePathToDelete);
            } else if (filePath) {
                 console.log(`FINALLY: Zip file already deleted or never created: ${zipFilePathToDelete}`);
            }
        } catch (cleanupError) {
            console.error("FINALLY: Cleanup error:", cleanupError);
        }
     }, 5000); // Consider if this delay is still needed/optimal
  }
}