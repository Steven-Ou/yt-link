export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip'; // Use import syntax
import { exec } from 'child_process'; // Use import syntax
import { promisify } from 'util'; // To promisify exec if needed, or use Promise wrapper

const execPromise = promisify(exec); // Optional: using promisify

export async function POST(request) {
  console.log('--- DOWNLOAD PLAYLIST API ROUTE HIT ---');
  let folder; // Define folder and filePath outside try scope for finally block
  let filePath;

  try {
    const { playlistUrl } = await request.json();
    if (!playlistUrl) {
      return NextResponse.json({ error: 'No playlist URL provided' }, { status: 400 });
    }
    console.log(`Received playlist URL: ${playlistUrl}`);

    folder = `playlist_${Date.now()}`;
    const folderPath = path.resolve(folder); // Use absolute path for clarity
    console.log(`Attempting to create directory: ${folderPath}`);
    fs.mkdirSync(folderPath);
    console.log(`Directory created: ${folderPath}`);

     // --- Execute yt-dlp with corrected error handling ---
     const command = `yt-dlp -o "${path.join(folderPath, '%(playlist_index)s.%(title)s.%(ext)s')}" --verbose ${playlistUrl}`;
     console.log(`Executing command: ${command}`);
 
     await new Promise((resolve, reject) => {
       exec(command, (error, stdout, stderr) => {
         // Log output regardless
         console.log('yt-dlp stdout:\n', stdout);
         console.error('yt-dlp stderr:\n', stderr); // Log stderr even if not treating as error
 
         // PRIMARY FAILURE CHECK: Did exec return an error object?
         if (error) {
           console.error(`yt-dlp exec error detected: ${error.message}`);
           // Reject the promise ONLY if exec reports an error
           return reject(new Error(`yt-dlp failed with error: ${error.message}. Stderr: ${stderr}`));
         }
 
         // Optional: Log stderr presence as a warning, but don't reject based on it
         if (stderr) {
            console.warn('yt-dlp produced stderr output (logged above). Continuing unless exec error occurred.');
         }
 
         console.log('yt-dlp command finished without exec error.');
         resolve(); // Resolve the promise as exec didn't return an error object
       });
     });
     // --- End yt-dlp execution ---
 
     // The rest of your code (checking files, zipping, streaming) follows...
     console.log(`Proceeding after yt-dlp execution.`); // Add this log
 
     // Check if folder contains files before zipping
    const files = fs.readdirSync(folderPath);
    console.log(`Files found in ${folderPath}:`, files);
    if (files.length === 0) {
        console.error(`No files downloaded by yt-dlp into ${folderPath}. Aborting zip.`);
        throw new Error('yt-dlp did not download any files.');
    }

    const zip = new AdmZip();
    const outputFile = `${folder}.zip`; // Keep zip in current dir for now, or use path.join(folderPath, '..', `${folder}.zip`)
    filePath = path.resolve(outputFile); // Absolute path to zip file
    console.log(`Attempting to zip folder: ${folderPath} into ${filePath}`);
    zip.addLocalFolder(folderPath);
    console.log(`Attempting to write zip file: ${filePath}`);
    zip.writeZip(filePath); // Write zip file
    console.log(`Zip file should be written: ${filePath}`);

    console.log(`Checking for zip file existence at: ${filePath}`);
    const stats = fs.statSync(filePath); // Check if zip file exists NOW
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
    // Ensure response is always sent
    return NextResponse.json({ error: `Playlist download failed: ${error.message}` }, { status: 500 });
  } finally {
     // Cleanup logic here (use the delayed version from previous suggestion or improve it)
     setTimeout(() => {
        try {
            const folderPath = folder ? path.resolve(folder) : null; // Resolve path again just in case
            const zipFilePath = filePath ? path.resolve(filePath) : null;

            if (folderPath && fs.existsSync(folderPath)) {
                console.log(`FINALLY: Cleaning up folder: ${folderPath}`);
                fs.rmSync(folderPath, { recursive: true, force: true });
            }
            if (zipFilePath && fs.existsSync(zipFilePath)) {
                console.log(`FINALLY: Cleaning up file: ${zipFilePath}`);
                fs.unlinkSync(zipFilePath);
            }
        } catch (cleanupError) {
            console.error("FINALLY: Cleanup error:", cleanupError);
        }
     }, 5000); // Adjust delay as needed
  }
}