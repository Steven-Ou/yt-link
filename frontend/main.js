// --- ELECTRON AND NODE.JS IMPORTS ---
// This section imports all the necessary modules for the application to run.
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // Core Electron modules for app lifecycle, window creation, inter-process communication, and native dialogs.
const path = require('path'); // Node.js utility for handling and transforming file paths in a cross-platform way.
const url = require('url'); // Node.js utility for URL parsing, essential for creating `file://` URLs for local content.
const fs = require('fs'); // Node.js File System module, used here for file operations like copying the downloaded file.
const { spawn } = require('child_process'); // Node.js module to create and manage independent child processes, used here to run the Python backend.
const { autoUpdater } = require('electron-updater'); // The primary module for handling automatic application updates from a release server like GitHub.
const fetch = require('node-fetch'); // A light-weight module that brings the browser's `fetch` API to Node.js, for making HTTP requests from the main process.

// --- GLOBAL VARIABLES ---
// These are declared in the global scope to be accessible throughout the file.
let mainWindow; // This will hold the main application window object. It's kept global to prevent garbage collection from closing the window prematurely.
let pythonProcess = null; // This will hold the spawned Python backend process object, allowing us to manage it (e.g., terminate it when the app quits).

// --- PYTHON BACKEND MANAGEMENT ---
/**
 * Starts the Python Flask server as a background child process.
 * This function determines the correct path to the Python script for production,
 * spawns the process, and sets up listeners to capture its output for debugging.
 */
function startPythonBackend() {
    // In a packaged Electron app, extra files (like our Python service) are stored in a 'resources' directory.
    // `process.resourcesPath` provides the reliable, cross-platform path to this directory.
    const servicePath = path.join(process.resourcesPath, 'service');
    const scriptPath = path.join(servicePath, 'app.py');
    // Use a platform-specific command to ensure the correct Python executable is called.
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

    console.log(`[Python Start] Attempting to run: ${pythonCommand} at ${scriptPath}`);
    // Spawn the python process. This runs the script as a separate, non-blocking process.
    pythonProcess = spawn(pythonCommand, [scriptPath]);

    // **CRITICAL:** Add a listener for the 'error' event on the child process.
    // This catches errors where the process fails to spawn at all, such as when the `python3`
    // command isn't found on the user's system.
    pythonProcess.on('error', (err) => {
        console.error('[Python Start] CRITICAL: Failed to start Python backend process.', err);
        // Show a user-friendly error dialog. This is much better than failing silently.
        dialog.showErrorBox(
            'Backend Service Error',
            'The required backend service could not be started. This can happen if Python 3 is not installed or not in your system PATH. Please contact support.'
        );
    });

    // Listen for standard output (`print` statements) from the Python script and log it for debugging.
    pythonProcess.stdout.on('data', (data) => console.log(`[Python Backend]: ${data.toString()}`));
    // Listen for standard error and log it to help diagnose issues in the backend.
    pythonProcess.stderr.on('data', (data) => console.error(`[Python Backend Error]: ${data.toString()}`));
    // Log a message when the Python process closes, showing its exit code.
    pythonProcess.on('close', (code) => console.log(`[Python Backend] Exited with code ${code}`));
}

// --- ELECTRON WINDOW CREATION ---
/**
 * Creates and configures the main application window (BrowserWindow).
 * This function handles window dimensions, web preferences for security, and loading the UI content.
 */
function createWindow() {
    // Use Electron's built-in `app.isPackaged` property. This is the modern, reliable way to check the environment.
    // It's `false` when running locally (`npm run electron:dev`) and `true` when the app is packaged.
    const isDev = !app.isPackaged;

    // Create a new browser window instance.
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            // The preload script is the secure bridge between this main process (Node.js) and the renderer process (the UI).
            preload: path.join(__dirname, 'preload.js'),
            // `contextIsolation` is a key security feature. It prevents the renderer from accessing Node.js APIs directly.
            contextIsolation: true,
            // `nodeIntegration` must be false for security.
            nodeIntegration: false,
        },
    });

    // Determine what content to load into the window based on the environment.
    const startUrl = isDev
        ? 'http://localhost:3000' // In development, load the Next.js dev server for hot-reloading.
        : `file://${path.join(__dirname, 'out/index.html')}`; // In production, load the static HTML file generated by `next build`.

    mainWindow.loadURL(startUrl);

    // Perform environment-specific actions.
    if (isDev) {
        // Automatically open the Chrome DevTools for debugging during development.
        mainWindow.webContents.openDevTools();
    } else {
        // Only configure and check for auto-updates in the packaged production app.
        autoUpdater.on('update-available', () => mainWindow.webContents.send('update-status', 'Update available.'));
        autoUpdater.on('update-downloaded', () => mainWindow.webContents.send('update-status', 'Update downloaded. Click restart to install.'));
        mainWindow.once('ready-to-show', () => {
            autoUpdater.checkForUpdatesAndNotify();
        });
    }
    
    // Event listener for when the window is closed.
    mainWindow.on('closed', () => {
        // Dereference the window object for memory management.
        mainWindow = null;
    });
}

// --- IPC AND APP LIFECYCLE ---

/**
 * A generic and secure handler to forward API requests from the UI to the Python backend.
 * @param {string} endpoint - The API endpoint on the Python server.
 * @param {object} body - The JSON payload to send.
 * @returns {Promise<object>} - The JSON response from the Python server or an error object.
 */
async function forwardToPython(endpoint, body) {
    const url = `http://127.0.0.1:8080/${endpoint}`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`Python service error: ${await response.text()}`);
        return await response.json();
    } catch (error) {
        console.error(`[Main->Python] CRITICAL ERROR:`, error);
        return { error: 'Failed to communicate with the backend service.' };
    }
}

// --- App Lifecycle Handlers ---

// This method is called when Electron has finished initialization.
app.on('ready', () => {
    // Only start the backend service when the app is packaged and running in production.
    if (app.isPackaged) {
      startPythonBackend();
    }
    createWindow(); // Create the main application window.
});

// This event fires when all windows have been closed.
app.on('window-all-closed', () => {
    // On macOS, it's standard for apps to stay active until explicitly quit. On other platforms (Windows, Linux), we quit.
    if (process.platform !== 'darwin') app.quit();
});

// This event fires just before the application begins to close its windows.
app.on('before-quit', () => {
    // It's crucial to terminate the child process to prevent it from becoming a "zombie" process after the main app closes.
    if (pythonProcess) {
        console.log('Killing Python backend process...');
        pythonProcess.kill();
    }
});

// On macOS, this event fires when the dock icon is clicked and there are no other windows open.
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- IPC Handlers for Frontend API ---
// These handlers define the secure API that the frontend can use to interact with the main process.

ipcMain.handle('start-single-mp3-job', (_, args) => forwardToPython('start-single-mp3-job', args));
ipcMain.handle('start-playlist-zip-job', (_, args) => forwardToPython('start-playlist-zip-job', args));
ipcMain.handle('start-combine-playlist-mp3-job', (_, args) => forwardToPython('start-combine-playlist-mp3-job', args));

ipcMain.handle('get-job-status', async (_, jobId) => {
    try {
        const response = await fetch(`http://127.0.0.1:8080/job-status/${jobId}`);
        return await response.json();
    } catch (error) {
        return { error: 'Failed to get job status.' };
    }
});

ipcMain.handle('save-file', async (event, jobInfo) => {
    if (!jobInfo || !jobInfo.filepath || !jobInfo.filename) return { error: 'Invalid job information provided.' };
    const { filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: jobInfo.filename });
    if (!filePath) return { success: false, reason: 'User cancelled save.' };
    try {
        fs.copyFileSync(jobInfo.filepath, filePath);
        return { success: true, path: filePath };
    } catch (error) {
        console.error('Failed to save file:', error);
        return { success: false, error: 'Failed to save file.' };
    }
});

ipcMain.on('restart-and-install', () => {
    autoUpdater.quitAndInstall();
});
