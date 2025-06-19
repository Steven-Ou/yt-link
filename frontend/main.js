// frontend/main.js

// --- ELECTRON AND NODE.JS IMPORTS ---
// This section imports all the necessary modules for the application to run.
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // Core Electron modules: `app` for managing the app's lifecycle, `BrowserWindow` for creating and controlling windows, `ipcMain` for handling messages from the renderer process, and `dialog` for native system dialogs.
const path = require('path'); // A Node.js utility for working with file and directory paths in a cross-platform way.
const url = require('url'); // A Node.js utility for URL resolution and parsing, crucial for creating `file://` URLs for local content.
const fs = require('fs'); // The Node.js File System module, used here for file operations like copying the downloaded file.
const { spawn } = require('child_process'); // A Node.js module to create and manage child processes. We use it to run the Python backend script independently.
const { autoUpdater } = require('electron-updater'); // The primary module for handling automatic application updates from a release server like GitHub.
const fetch = require('node-fetch'); // A light-weight module that brings the browser's `fetch` API to Node.js, used for making HTTP requests from this main process to the Python backend.

// --- GLOBAL VARIABLES ---
// These variables are declared in the global scope to be accessible throughout the file.
let mainWindow; // This variable will hold the main application window object. It's kept global to prevent it from being garbage collected, which would close the window.
let pythonProcess = null; // This will hold the spawned Python backend process object. Storing it globally allows us to manage it, specifically to terminate it when the app quits.
const isDev = process.env.NODE_ENV !== 'production'; // A boolean flag to check if the app is running in development mode versus a packaged production environment. This is useful for conditional logic, like opening DevTools.

// --- PYTHON BACKEND MANAGEMENT ---
/**
 * Starts the Python Flask server as a background child process.
 * This function determines the correct path to the Python script for both development and production,
 * spawns the process, and sets up listeners to capture its standard output and error streams for debugging.
 */
function startPythonBackend() {
    // Correctly and robustly determine the path to the Python script.
    // In development, the path is relative to this `main.js` file.
    // In production, electron-builder unpacks the 'service' directory as specified in `package.json`, and we can access it relative to the app's root.
    // Electron's `__dirname` and `path.join` will resolve correctly even inside an ASAR archive for the child_process module.
    const scriptPath = path.join(__dirname, '..', 'service', 'app.py');
    
    // Use 'python' on Windows and 'python3' on other platforms to ensure the correct Python executable is called.
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

    console.log(`[Python Start] Attempting to run command: ${pythonCommand} at ${scriptPath}`);

    // Spawn the python process. This runs the script as a separate, non-blocking process.
    pythonProcess = spawn(pythonCommand, [scriptPath]);

    // Listen for standard output from the Python script (e.g., `print` statements) and log it for debugging.
    pythonProcess.stdout.on('data', (data) => {
        console.log(`[Python Backend]: ${data}`);
    });

    // Listen for standard error from the Python script and log it to help diagnose issues in the backend.
    pythonProcess.stderr.on('data', (data) => {
        console.error(`[Python Backend Error]: ${data}`);
    });

    // Log a message when the Python process closes, showing its exit code.
    pythonProcess.on('close', (code) => {
        console.log(`[Python Backend] Exited with code ${code}`);
    });
}

// --- ELECTRON WINDOW CREATION ---
/**
 * Creates and configures the main application window (BrowserWindow).
 * This function handles window dimensions, web preferences for security, and loading the UI content.
 */
function createWindow() {
    // Create a new browser window instance.
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            // The preload script is a crucial piece of Electron's security model. It runs in a privileged context
            // and acts as the secure bridge between the Node.js main process and the sandboxed renderer process (the UI).
            preload: path.join(__dirname, 'preload.js'),
            // `contextIsolation` is a key security feature. When true, it ensures the preload script and the renderer's
            // main world do not share the same `window` object, preventing the renderer from accessing Node.js APIs directly.
            contextIsolation: true,
            // `nodeIntegration` must be false for security best practices. All Node.js logic should be handled
            // in the main process or exposed selectively through the preload script.
            nodeIntegration: false,
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.png'), // Sets the application icon for the window and taskbar.
    });

    // --- AUTO-UPDATER CONFIGURATION ---
    // Sets up the auto-updater to check for releases on the specified GitHub repository.
    autoUpdater.setFeedURL({ provider: 'github', owner: 'steven-ou', repo: 'yt-link' });
    
    // --- Auto-Updater Event Listeners ---
    // These listeners send messages to the UI (renderer process) via IPC when an update event occurs.
    autoUpdater.on('update-available', () => mainWindow.webContents.send('update-status', 'Update available.'));
    autoUpdater.on('update-downloaded', () => mainWindow.webContents.send('update-status', 'Update downloaded. Click restart to install.'));
    autoUpdater.on('checking-for-update', () => mainWindow.webContents.send('update-status', 'Checking for updates...'));
    autoUpdater.on('error', (err) => mainWindow.webContents.send('update-status', `Update error: ${err.message}`));
    autoUpdater.on('download-progress', (p) => mainWindow.webContents.send('update-download-progress', p));

    // --- LOADING UI CONTENT ---
    // This logic determines what content to load into the window based on the environment.
    if (isDev) {
        // In development, load the Next.js development server URL, which supports hot-reloading.
        mainWindow.loadURL('http://localhost:3000');
        // Automatically open the Chrome DevTools for easy debugging during development.
        mainWindow.webContents.openDevTools();
    } else {
        // In production, load the static HTML file generated by `next export`.
        // **FIX:** Using `loadURL` with the `file://` protocol is more reliable for local files than `loadFile`.
        const startUrl = url.format({
            pathname: path.join(__dirname, 'out/index.html'),
            protocol: 'file:',
            slashes: true
        });
        mainWindow.loadURL(startUrl);
    }
    
    // Once the window is fully rendered and ready, check for updates (in production only).
    mainWindow.once('ready-to-show', () => {
      if (!isDev) {
        autoUpdater.checkForUpdatesAndNotify();
      }
    });

    // Event listener for when the window is closed.
    mainWindow.on('closed', () => {
        // Dereference the window object. This is important for memory management and allows the object to be garbage collected.
        mainWindow = null;
    });
}

// --- IPC COMMUNICATION BRIDGE ---
/**
 * A generic handler to securely forward API requests from the renderer process (UI) 
 * to the Python backend via an HTTP request.
 */
async function forwardToPython(endpoint, body) {
    // Construct the full URL for the Python backend endpoint.
    const url = `http://127.0.0.1:8080/${endpoint}`;
    console.log(`[Main->Python] POST to ${url} with body: ${JSON.stringify(body)}`);
    try {
        // Use node-fetch to make the HTTP POST request.
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        // If the Python service returns an error status code, throw an error to be caught below.
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Python service error: ${errorText}`);
        }
        // If successful, parse the JSON response and return it to the renderer process.
        return await response.json();
    } catch (error) {
        // Catch any network or other errors and log them.
        console.error(`[Main->Python] CRITICAL ERROR:`, error);
        // Return a structured error object to the renderer process so it can handle the failure gracefully.
        return { error: 'Failed to communicate with the backend service.' };
    }
}

// --- ELECTRON APP LIFECYCLE EVENTS ---
// These `app.on` event handlers control the application's lifecycle.

// This method is called when Electron has finished initialization and is ready to create browser windows.
app.on('ready', () => {
    startPythonBackend(); // Start the backend service first.
    createWindow();       // Then create the main application window.
});

// This event fires when all windows have been closed.
app.on('window-all-closed', () => {
    // On macOS, it's common for applications to stay active until the user explicitly quits.
    // On other platforms (Windows, Linux), we quit the app.
    if (process.platform !== 'darwin') app.quit();
});

// This event fires just before the application begins to close its windows.
app.on('before-quit', () => {
    // It's crucial to terminate the child process to prevent it from becoming a "zombie" process.
    if (pythonProcess) {
        console.log('Killing Python backend process...');
        pythonProcess.kill();
    }
});

// On macOS, this event fires when the dock icon is clicked and there are no other windows open.
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- IPC HANDLERS ---
// These handlers listen for specific messages from the renderer process (sent via the preload script).
// They define the API that the frontend can use to interact with the main process.

ipcMain.handle('start-single-mp3-job', (_, args) => forwardToPython('start-single-mp3-job', args));
ipcMain.handle('start-playlist-zip-job', (_, args) => forwardToPython('start-playlist-zip-job', args));
ipcMain.handle('start-combine-playlist-mp3-job', (_, args) => forwardToPython('start-combine-playlist-mp3-job', args));

ipcMain.handle('get-job-status', async (_, jobId) => {
    try {
        const response = await fetch(`http://127.0.0.1:8080/job-status/${jobId}`);
        return await response.json();
    } catch (error) {
        console.error(`Error checking status for job ${jobId}:`, error);
        return { error: 'Failed to get job status.' };
    }
});

// **NEW:** This handler manages the file download process.
ipcMain.handle('save-file', async (event, jobInfo) => {
    // Basic validation to ensure we have the necessary info from the renderer.
    if (!jobInfo || !jobInfo.filepath || !jobInfo.filename) {
        return { error: 'Invalid job information for saving file.' };
    }

    // Show a native "Save As..." dialog to the user, suggesting the original filename.
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save File',
        defaultPath: jobInfo.filename,
    });

    // If the user cancels the save dialog, `filePath` will be null or undefined.
    if (!filePath) {
        return { success: false, reason: 'User cancelled save dialog.' };
    }

    // Use the `fs` module to copy the file from the temporary backend location to the user's chosen destination.
    try {
        fs.copyFileSync(jobInfo.filepath, filePath);
        console.log(`File saved successfully to: ${filePath}`);
        return { success: true, path: filePath };
    } catch (error) {
        console.error('Failed to save file:', error);
        return { success: false, error: 'Failed to save file.' };
    }
});

// Listens for the 'restart-and-install' message from the UI to trigger the update process.
ipcMain.on('restart-and-install', () => {
    autoUpdater.quitAndInstall();
});
