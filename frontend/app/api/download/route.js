// /app/api/download/route.js

// Use execFile with resolved path for yt-dlp binary
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { execFile } from 'child_process'; // Use execFile
import fs from 'fs';
import path from 'path';
import os from 'os';
// Keep yt-dlp-exec installed for its binary, but find the path manually
// import ytDlpExec from 'yt-dlp-exec'; // No longer calling the wrapper function

// --- Find the yt-dlp binary path ---
let ytDlpPath;
try {
    // This attempts to find the binary installed by yt-dlp-exec
    // Adjust the relative path if necessary based on yt-dlp-exec's structure
    // Common paths might be 'yt-dlp-exec/bin/yt-dlp' or similar
    // Use require.resolve which throws an error if not found
    const packagePath = require.resolve('yt-dlp-exec');
    // Go up from the package's main file path to find the likely bin directory
    // This assumes a standard package structure; might need adjustment
    const binPathGuess = path.join(path.dirname(packagePath), '../bin/yt-dlp'); // Common structure guess
    const binPathGuessExe = path.join(path.dirname(packagePath), '../bin/yt-dlp.exe'); // Windows guess

    if (fs.existsSync(binPathGuess)) {
        ytDlpPath = binPathGuess;
    } else if (fs.existsSync(binPathGuessExe)) {
        ytDlpPath = binPathGuessExe; // Use .exe if found (for Windows)
    } else {
         // Fallback: Try finding it directly within node_modules if the above guess fails
         const directPath = path.join(process.cwd(), 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
         const directPathExe = path.join(process.cwd(), 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe');
         if (fs.existsSync(directPath)) {
            ytDlpPath = directPath;
         } else if (fs.existsSync(directPathExe)) {
             ytDlpPath = directPathExe;
         } else {
            throw new Error('yt-dlp binary not found via require.resolve or direct path.');
         }
    }
    console.log(`Found yt-dlp binary at: ${ytDlpPath}`);
    // Optional: Check execute permissions (might not work reliably in all envs)
    // try { fs.accessSync(ytDlpPath, fs.constants.X_OK); } catch { console.warn(`Warning: yt-dlp binary at ${ytDlpPath} might not have execute permissions.`); }

} catch (err) {
    console.error("Error finding yt-dlp path:", err);
    // Handle error - perhaps yt-dlp-exec isn't installed correctly
    // Set path to null or a default to indicate failure
    ytDlpPath = null;
}
// --- End find binary path ---


export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (execFile) API ROUTE HIT ---');

  // Check if ytDlpPath was found
  if (!ytDlpPath) {
      console.error("yt-dlp binary path could not be determined. Ensure 'yt-dlp-exec' is installed.");
      return NextResponse.json({ error: "Server configuration error: yt-dlp not found." }, { status: 500 });
  }

  const { url } = await request.json();
  if (!url) {
    return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
  }

  const tempDir = path.join(os.tmpdir(), `single_dl_${Date.now()}`);
  let actualMp3Path = null;

  try {
    console.log(`Attempting to create temporary directory: ${tempDir}`);
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`Temporary directory created: ${tempDir}`);

    // --- 1. Download Single MP3 using execFile ---
    console.log(`Executing yt-dlp binary directly from: ${ytDlpPath}`);

    // Define output path template using video title
    const outputTemplate = path.join(tempDir, '%(title)s.%(ext)s');

    // Define arguments for execFile
    const args = [
        url, // URL first
        '-x', // Extract audio
        '--audio-format', 'mp3', // Specify MP3 format
        '-o', outputTemplate // Output template
        // Add other flags as needed
    ];

    console.log('yt-dlp execFile args:', args);

    // Execute using execFile - returns stdout/stderr in callback or promise
    await new Promise((resolve, reject) => {
        execFile(ytDlpPath, args, (error, stdout, stderr) => {
            // Log output regardless
            if (stdout) console.log('yt-dlp stdout:\n', stdout);
            if (stderr) console.error('yt-dlp stderr:\n', stderr);

            if (error) {
                console.error(`yt-dlp execFile error: ${error.message}`);
                // Include stderr in rejection if available
                error.stderrContent = stderr; // Attach stderr for better debugging
                return reject(error);
            }
            // If no error object, assume success
            console.log('yt-dlp execFile finished successfully.');
            resolve({ stdout, stderr });
        });
    });

    // Find the downloaded MP3 file (as filename is dynamic)
    console.log(`Searching for MP3 file in ${tempDir}`);
    const files = fs.readdirSync(tempDir);
    const mp3File = files.find(f => f.toLowerCase().endsWith('.mp3'));

    if (mp3File) {
        actualMp3Path = path.join(tempDir, mp3File);
        console.log(`Found downloaded MP3: ${actualMp3Path}`);
    } else {
        throw new Error(`yt-dlp finished, but no MP3 file was found in ${tempDir}. Files present: ${files.join(', ')}.`);
    }

    console.log('yt-dlp MP3 download and conversion finished.');

    // --- 2. Prepare and Stream the MP3 File ---
    // (Rest of the streaming logic remains the same as before)
    const stats = fs.statSync(actualMp3Path);
    const dataStream = fs.createReadStream(actualMp3Path);
    const filenameForUser = path.basename(actualMp3Path);
    console.log(`Streaming MP3 file: ${actualMp3Path}, Size: ${stats.size}, Filename for user: ${filenameForUser}`);
    const fallbackFilename = 'downloaded_audio.mp3';
    const encodedFilename = encodeURIComponent(filenameForUser);
    const contentDispositionValue = `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`;
    console.log(`Setting Content-Disposition: ${contentDispositionValue}`);
    const responseStream = new ReadableStream({
        start(controller) { /* ... stream handling ... */
            dataStream.on('data', (chunk) => controller.enqueue(chunk));
            dataStream.on('end', () => { controller.close(); cleanupTempFiles(tempDir); });
            dataStream.on('error', (err) => { controller.error(err); cleanupTempFiles(tempDir); });
        },
        cancel() { /* ... cancel handling ... */
             dataStream.destroy(); cleanupTempFiles(tempDir);
        }
    });
    return new NextResponse(responseStream, {
      status: 200,
      headers: { /* ... headers ... */
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': contentDispositionValue,
        'Content-Length': stats.size.toString(),
       },
    });

  } catch (error) {
    console.error('API /api/download final catch error:', error);
    let errorMessage = `Download failed: ${error.message}`;
    // Add stderr if the error object contains it (attached in the promise reject)
    if (error.stderrContent) {
        errorMessage += `\nStderr: ${error.stderrContent.substring(0, 500)}`;
    }
    cleanupTempFiles(tempDir);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Helper function for cleanup
function cleanupTempFiles(folderPath) {
     setTimeout(() => {
        try {
            if (folderPath && fs.existsSync(folderPath)) {
                console.log(`CLEANUP: Removing folder: ${folderPath}`);
                fs.rmSync(folderPath, { recursive: true, force: true });
            }
        } catch (cleanupError) {
            console.error("CLEANUP: Error:", cleanupError);
        }
    }, 1000);
}
