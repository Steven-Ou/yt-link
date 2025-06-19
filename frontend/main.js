// frontend/main.js

// --- ELECTRON AND NODE.JS IMPORTS ---
// Import necessary modules from the Electron framework and Node.js.
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // Core Electron modules for app lifecycle, window creation, and inter-process communication.
const path = require('path'); // Node.js module for handling and transforming file paths.
const { spawn } = require('child_process'); // Node.js module for creating and managing child processes, used here to run the Python backend.
const { autoUpdater } = require('electron-updater'); // Handles automatic application updates from a release server (like GitHub).
const fetch = require('node-fetch'); // A light-weight module that brings the browser's `fetch` API to Node.js, used for making HTTP requests.

// --- GLOBAL VARIABLES ---
let mainWindow; // This variable will hold the main application window object. It's global to prevent it from being garbage collected.
let pythonProcess = null; // This will hold the spawned Python backend process object, allowing us to manage it (e.g., kill it on app quit).
const isDev = process.env.NODE_ENV !== 'production'; // A boolean flag to check if the app is running in development mode.

// --- PYTHON BACKEND MANAGEMENT ---
/**
 * Starts the Python Flask server as a background child process.
 * This function determines the correct path to the Python script for both development and production,
 * spawns the process, and sets up listeners to capture its output for debugging.
 */
function startPythonBackend() {
    // Determine the path to the Python script based on the environment.
    const scriptPath = isDev
        ? path.join(__dirname, '..', 'service', 'app.py') // In development, the path is relative to the current file.
        : path.join(process.resourcesPath, 'app', 'service', 'app.py'); // In production, it's inside the packaged app's resources directory.

    // Use 'python' on Windows and 'python3' on other platforms.
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

    console.log(`Starting Python backend with command: ${pythonCommand} ${scriptPath}`);

    // Spawn the python process. This runs the script as a separate process.
    pythonProcess = spawn(pythonCommand, [scriptPath]);

    // Listen for standard output from the Python script (e.g., print statements) and log it.
    pythonProcess.stdout.on('data', (data) => {
        console.log(`Python Backend: ${data}`);
    });

    // Listen for standard error from the Python script and log it.
    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python Backend Error: ${data}`);
    });

    // Log when the Python process closes.
    pythonProcess.on('close', (code) => {
        console.log(`Python Backend exited with code ${code}`);
    });
}

// --- ELECTRON WINDOW CREATION ---
/**
 * Creates and configures the main application window (BrowserWindow).
 * It sets up web preferences, loads the UI content, and configures the auto-updater.
 */
function createWindow() {
    // Create a new browser window.
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            // The preload script acts as a secure bridge between the Electron main process and the renderer process (the UI).
            preload: path.join(__dirname, 'preload.js'),
            // contextIsolation is a security feature that ensures the preload script and the renderer's main world do not share the same `window` object.
            contextIsolation: true,
            // nodeIntegration should be false for security. All Node.js logic should be in the main process or preload script.
            nodeIntegration: false,
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.png'), // Sets the application icon.
    });

    // --- AUTO-UPDATER CONFIGURATION ---
    // Configure the auto-updater to check for releases on the specified GitHub repository.
    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'steven-ou',
        repo: 'yt-link',
    });
    
    // --- Auto-Updater Event Listeners ---
    // These listeners send messages to the UI (renderer process) when an update event occurs.
    autoUpdater.on('update-available', () => {
        mainWindow.webContents.send('update-status', 'Update available.');
    });
    autoUpdater.on('update-downloaded', () => {
        mainWindow.webContents.send('update-status', 'Update downloaded. Restart the app to install.');
    });
    autoUpdater.on('checking-for-update', () => {
        mainWindow.webContents.send('update-status', 'Checking for updates...');
    });
    autoUpdater.on('error', (err) => {
        mainWindow.webContents.send('update-status', `Update error: ${err.message}`);
    });
    autoUpdater.on('download-progress', (progressObj) => {
        mainWindow.webContents.send('update-download-progress', progressObj);
    });

    // --- LOADING UI CONTENT ---
    // Load the correct content based on whether the app is in development or production.
    if (isDev) {
        // In development, load the Next.js development server URL.
        mainWindow.loadURL('http://localhost:3000');
        // Automatically open the Chrome DevTools for debugging.
        mainWindow.webContents.openDevTools();
    } else {
        // In production, load the static HTML file generated by 'next export'.
        const indexPath = path.join(__dirname, 'out', 'index.html');
        mainWindow.loadFile(indexPath);
    }
    
    // Check for updates once the window is ready to be shown.
    mainWindow.once('ready-to-show', () => {
      autoUpdater.checkForUpdatesAndNotify();
    });

    // Event listener for when the window is closed.
    mainWindow.on('closed', () => {
        // Dereference the window object to allow for garbage collection.
        mainWindow = null;
    });
}

// --- IPC COMMUNICATION BRIDGE ---
/**
 * A generic handler to securely forward API requests from the renderer process (UI) 
 * to the Python backend via HTTP. This acts as a bridge.
 * @param {string} endpoint - The API endpoint to call on the Python server (e.g., 'start-single-mp3-job').
 * @param {object} body - The JSON data to send with the request.
 * @returns {Promise<object>} - A promise that resolves with the JSON response from the Python server.
 */
async function forwardToPython(endpoint, body) {
    const url = `http://127.0.0.1:8080/${endpoint}`;
    console.log(`[main.js] Forwarding to Python: POST to ${url}`);
    console.log(`[main.js] Body: ${JSON.stringify(body)}`);

    try {
        // Make the HTTP POST request to the Python Flask server.
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        // Check if the request was successful.
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[main.js] Python service returned an error. Status: ${response.status}, Body: ${errorText}`);
            throw new Error(`Python service error: ${errorText}`);
        }

        // Parse the JSON response and return it.
        const data = await response.json();
        console.log('[main.js] Success response from Python:', data);
        return data;
    } catch (error) {
        // Catch any network or other errors during the fetch call.
        console.error('[main.js] CRITICAL: Failed to communicate with Python backend.', error);
        return { error: 'Failed to communicate with the backend service.' };
    }
}

// --- ELECTRON APP LIFECYCLE EVENTS ---

// This method will be called when Electron has finished initialization.
app.on('ready', () => {
    startPythonBackend(); // Start the backend server.
    createWindow();       // Then create the application window.
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') { // On macOS, apps usually stay open in the dock.
        app.quit();
    }
});

// Before the application quits, ensure the Python backend process is terminated.
app.on('before-quit', () => {
    if (pythonProcess) {
        console.log('Killing Python backend process...');
        pythonProcess.kill();
    }
});

// On macOS, re-create a window if the dock icon is clicked and no windows are open.
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// --- IPC HANDLERS ---
// These handlers listen for messages from the renderer process (sent via the preload script).
// They are the bridge between the UI and the main process logic.

// Handles the request to start a single MP3 download job.
ipcMain.handle('start-single-mp3-job', (event, args) => {
    return forwardToPython('start-single-mp3-job', args);
});

// Handles the request to start a playlist ZIP download job.
ipcMain.handle('start-playlist-zip-job', (event, args) => {
    return forwardToPython('start-playlist-zip-job', args);
});

// Handles the request to combine a playlist into a single MP3.
ipcMain.handle('start-combine-playlist-mp3-job', (event, args) => {
    return forwardToPython('start-combine-playlist-mp3-job', args);
});

// Handles requests from the UI to check the status of a specific job.
ipcMain.handle('get-job-status', async (event, jobId) => {
    try {
        const response = await fetch(`http://127.0.0.1:8080/job-status/${jobId}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`Error checking status for job ${jobId}:`, error);
        return { error: 'Failed to get job status.' };
    }
});

// Listens for the 'restart-and-install' message from the UI to trigger the update process.
ipcMain.on('restart-and-install', () => {
    autoUpdater.quitAndInstall();
});
