// --- ELECTRON AND NODE.JS IMPORTS ---
// This section imports all the necessary modules for the application to run.
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // Core Electron modules.
const path = require('path'); // Node.js utility for handling file paths.
const url = require('url'); // Node.js utility for URL parsing, used for creating file:// URLs.
const fs = require('fs'); // Node.js File System module for file operations.
const { spawn } = require('child_process'); // Node.js module to create and manage child processes (for the Python backend).
const isDev = require('electron-is-dev'); // A handy utility to easily check if we are in development mode.
const { autoUpdater } = require('electron-updater'); // The primary module for handling automatic application updates.
const fetch = require('node-fetch'); // A module that brings the `fetch` API to Node.js for making HTTP requests.

// --- GLOBAL VARIABLES ---
// Declared globally to be accessible throughout the file.
let mainWindow; // Holds the main application window object to prevent it from being garbage collected.
let pythonProcess = null; // Holds the spawned Python backend process, so we can manage it (e.g., terminate it on app quit).

// --- PYTHON BACKEND MANAGEMENT ---
/**
 * Starts the Python Flask server as a background child process.
 * This function determines the correct path to the Python script for both development
 * and production, spawns the process, and captures its output for debugging.
 */
function startPythonBackend() {
    // In production, the 'service' folder must be packaged with the app.
    // The best way to do this is using the `extraResources` option in electron-builder.
    // This makes the path consistent across environments.
    const servicePath = path.join(process.resourcesPath, 'service');
    const scriptPath = path.join(servicePath, 'app.py');

    // Use a platform-specific command to ensure the correct Python executable is called.
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

    console.log(`[Python Start] Production mode detected. Looking for script at: ${scriptPath}`);

    // Spawn the python process. This runs the script as a separate, non-blocking process.
    pythonProcess = spawn(pythonCommand, [scriptPath]);

    // Listen for standard output from the Python script (e.g., `print` statements) and log it.
    pythonProcess.stdout.on('data', (data) => {
        console.log(`[Python Backend]: ${data}`);
    });

    // Listen for standard error and log it to help diagnose issues in the backend.
    pythonProcess.stderr.on('data', (data) => {
        console.error(`[Python Backend Error]: ${data}`);
    });

    // Log a message when the Python process closes.
    pythonProcess.on('close', (code) => {
        console.log(`[Python Backend] Exited with code ${code}`);
    });
}


// --- ELECTRON WINDOW CREATION ---
/**
 * Creates and configures the main application window (BrowserWindow).
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            // The preload script is the secure bridge between the Node.js main process
            // and the sandboxed renderer process (the UI).
            preload: path.join(__dirname, 'preload.js'),
            // contextIsolation is a key security feature. It prevents the renderer from accessing Node.js APIs directly.
            contextIsolation: true,
            // nodeIntegration must be false for security.
            nodeIntegration: false,
        },
        // It's good practice to set an icon. Ensure you have an icon file at this path.
        // icon: path.join(__dirname, 'build/icon.png'),
    });

    // --- LOADING UI CONTENT ---
    // Load the Next.js dev server in development, or the static HTML file in production.
    const startUrl = isDev
        ? 'http://localhost:3000'
        : `file://${path.join(__dirname, 'out/index.html')}`;

    mainWindow.loadURL(startUrl);

    // --- AUTO-UPDATER CONFIGURATION ---
    if (!isDev) {
        // These listeners send messages to the UI (renderer process) about the update status.
        autoUpdater.on('update-available', () => mainWindow.webContents.send('update-status', 'Update available.'));
        autoUpdater.on('update-downloaded', () => mainWindow.webContents.send('update-status', 'Update downloaded. Click restart to install.'));
        autoUpdater.on('checking-for-update', () => mainWindow.webContents.send('update-status', 'Checking for updates...'));
        autoUpdater.on('error', (err) => mainWindow.webContents.send('update-status', `Update error: ${err.message}`));
        autoUpdater.on('download-progress', (p) => mainWindow.webContents.send('update-download-progress', p));
        
        // Once the window is ready, check for updates.
        mainWindow.once('ready-to-show', () => {
            autoUpdater.checkForUpdatesAndNotify();
        });
    } else {
        // Automatically open the Chrome DevTools for debugging in development.
        mainWindow.webContents.openDevTools();
    }
    
    // Dereference the window object on close for memory management.
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// --- IPC COMMUNICATION BRIDGE ---
/**
 * Securely forwards API requests from the UI to the Python backend.
 */
async function forwardToPython(endpoint, body) {
    const url = `http://127.0.0.1:8080/${endpoint}`;
    console.log(`[Main->Python] POST to ${url} with body: ${JSON.stringify(body)}`);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Python service error: ${await response.text()}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`[Main->Python] CRITICAL ERROR:`, error);
        return { error: 'Failed to communicate with the backend service.' };
    }
}

// --- ELECTRON APP LIFECYCLE EVENTS ---

// Called when Electron has finished initialization.
app.on('ready', () => {
    if (!isDev) {
      startPythonBackend(); // Start the backend service in production.
    }
    createWindow(); // Create the main application window.
});

// Called when all windows have been closed.
app.on('window-all-closed', () => {
    // On macOS, apps stay active. On other platforms, quit.
    if (process.platform !== 'darwin') app.quit();
});

// Called just before the application begins to close.
app.on('before-quit', () => {
    // It's crucial to terminate the child process to prevent "zombie" processes.
    if (pythonProcess) {
        console.log('Killing Python backend process...');
        pythonProcess.kill();
    }
});

// On macOS, re-create a window when the dock icon is clicked.
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- IPC HANDLERS ---
// Listen for messages from the renderer process.

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

// Handles the file download process.
ipcMain.handle('save-file', async (event, jobInfo) => {
    if (!jobInfo || !jobInfo.filepath || !jobInfo.filename) {
        return { error: 'Invalid job information provided.' };
    }

    // Show a native "Save As..." dialog.
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save File',
        defaultPath: jobInfo.filename,
    });

    // If the user cancels, do nothing.
    if (!filePath) {
        return { success: false, reason: 'User cancelled save.' };
    }

    // Copy the file from the temp location to the user's chosen destination.
    try {
        fs.copyFileSync(jobInfo.filepath, filePath);
        return { success: true, path: filePath };
    } catch (error) {
        console.error('Failed to save file:', error);
        return { success: false, error: 'Failed to save file.' };
    }
});

// Listens for the message from the UI to trigger the update install.
ipcMain.on('restart-and-install', () => {
    autoUpdater.quitAndInstall();
});
