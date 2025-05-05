// This is a Next.js API route for downloading a single MP3 file using yt-dlp.
// opt into Node.js runtime so you can use fs, child_process, etc.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { spawn } from 'child_process'; // Use spawn for robustness
import fs from 'fs';
import path from 'path';

export async function POST(request) {
  console.log('--- SINGLE DOWNLOAD (MP3 DIRECT) API ROUTE HIT ---');
  const { url } = await request.json();
  if (!url) {
    return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
  }

  // Use a temporary directory for the download
  const tempDir = path.join('/tmp', `single_dl_${Date.now()}`); // Use /tmp or os.tmpdir() if available
  let downloadedFilePath = null; // Keep track of the actual downloaded file path

  try {
    console.log(`Attempting to create temporary directory: ${tempDir}`);
    // Ensure parent directory exists if needed, handle potential errors
    // For simplicity here, assuming /tmp exists and is writable
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`Temporary directory created: ${tempDir}`);

    // --- 1. Download Single MP3 with yt-dlp using spawn ---
    console.log(`Spawning yt-dlp to download single MP3`);

    // Define arguments for spawn
    const ytdlpArgs = [
        '-x', // Extract audio
        '--audio-format', 'mp3', // Specify MP3 format
        // Output to the temp directory. Use a generic name or try to get title.
        // Using fixed name simplifies finding it later. Add --print filename to get actual name.
        '-o', path.join(tempDir, 'downloaded_audio.%(ext)s'), // Fixed name + extension placeholder
        '--print', 'filename', // Ask yt-dlp to print the final filename to stdout
        url // The URL for the single video/audio
    ];
    console.log('yt-dlp args:', ytdlpArgs);

    let stdoutData = '';
    let stderrData = '';

    const downloadedFilename = await new Promise((resolve, reject) => {
        const ytDlpProcess = spawn('yt-dlp', ytdlpArgs, { shell: false });

        ytDlpProcess.stdout.on('data', (data) => {
            console.log(`yt-dlp stdout: ${data}`);
            stdoutData += data.toString().trim(); // Capture stdout to get filename
        });
        ytDlpProcess.stderr.on('data', (data) => {
            console.error(`yt-dlp stderr: ${data}`);
            stderrData += data.toString();
        });
        ytDlpProcess.on('error', (err) => {
            reject(new Error(`yt-dlp spawn error: ${err.message}`));
        });
        ytDlpProcess.on('close', (code) => {
            if (code === 0) {
                // yt-dlp prints the final path to stdout because of --print filename
                console.log(`yt-dlp finished successfully. Filename from stdout: ${stdoutData}`);
                // Basic check if stdoutData looks like a path within our tempDir
                if (stdoutData && stdoutData.startsWith(tempDir) && stdoutData.endsWith('.mp3')) {
                     resolve(stdoutData); // Resolve with the actual path printed by yt-dlp
                } else {
                     // Fallback: try to find the mp3 file if stdout wasn't as expected
                     console.warn("Could not reliably get filename from stdout. Searching directory...");
                     const files = fs.readdirSync(tempDir);
                     const mp3File = files.find(f => f.toLowerCase().endsWith('.mp3'));
                     if (mp3File) {
                         console.log(`Found MP3 file via directory scan: ${mp3File}`);
                         resolve(path.join(tempDir, mp3File));
                     } else {
                        reject(new Error(`yt-dlp finished, but no MP3 file found in ${tempDir}. Files: ${files.join(', ')}. Stderr: ${stderrData.substring(0, 300)}`));
                     }
                }
            } else {
                reject(new Error(`yt-dlp failed with code ${code}. Stderr: ${stderrData.substring(0, 500)}`));
            }
        });
    });

    console.log('yt-dlp MP3 download finished.');
    downloadedFilePath = downloadedFilename; // Store the path for cleanup

    if (!fs.existsSync(downloadedFilePath)) {
         throw new Error(`Downloaded file path reported but not found: ${downloadedFilePath}`);
    }

    // --- 2. Prepare and Stream the MP3 File ---
    const stats = fs.statSync(downloadedFilePath);
    const dataStream = fs.createReadStream(downloadedFilePath);
    const filenameForUser = path.basename(downloadedFilePath); // Get just the filename part

    console.log(`Streaming MP3 file: ${downloadedFilePath}, Size: ${stats.size}`);

    // Use ReadableStream for better cleanup handling with NextResponse
    const responseStream = new ReadableStream({
        start(controller) {
            dataStream.on('data', (chunk) => {
                controller.enqueue(chunk); // Pass chunk to the response stream
            });
            dataStream.on('end', () => {
                console.log('File stream ended.');
                controller.close(); // Signal end of response stream
                 // Clean up AFTER the stream ends
                 cleanupTempFiles(tempDir, null); // Only clean the folder now
            });
            dataStream.on('error', (err) => {
                console.error('File stream error:', err);
                controller.error(err); // Signal error in response stream
                // Clean up even on stream error
                cleanupTempFiles(tempDir, null);
            });
        },
        cancel() {
            console.log('Response stream cancelled by client.');
            dataStream.destroy(); // Stop reading the file if client cancels
            // Clean up on cancellation
            cleanupTempFiles(tempDir, null);
        }
    });


    return new NextResponse(responseStream, {
      status: 200,
      headers: {
        // Set appropriate content type for MP3
        'Content-Type': 'audio/mpeg',
        // Suggest a filename for the user
        'Content-Disposition': `attachment; filename="${filenameForUser}"`,
        // Set content length
        'Content-Length': stats.size.toString(),
      },
    });

  } catch (error) {
    console.error('API /api/download final catch error:', error);
    // Ensure cleanup happens on error too
    cleanupTempFiles(tempDir, null); // Clean up folder if it exists
    return NextResponse.json({ error: `Download failed: ${error.message}` }, { status: 500 });
  }
  // NOTE: No finally block here - cleanup is handled by the stream events
}


// Helper function for cleanup
function cleanupTempFiles(folderPath, zipFilePath) {
     // Use setTimeout to slightly delay cleanup, ensuring response headers are sent
     // This is less critical with ReadableStream handling, but can prevent race conditions
     setTimeout(() => {
        try {
            if (folderPath && fs.existsSync(folderPath)) {
                console.log(`CLEANUP: Removing folder: ${folderPath}`);
                fs.rmSync(folderPath, { recursive: true, force: true });
            }
            // Only try to delete zip if path was provided (for the zip version)
            if (zipFilePath && fs.existsSync(zipFilePath)) {
                console.log(`CLEANUP: Removing file: ${zipFilePath}`);
                fs.unlinkSync(zipFilePath);
            }
        } catch (cleanupError) {
            console.error("CLEANUP: Error:", cleanupError);
        }
    }, 1000); // 1 second delay
}