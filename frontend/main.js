// frontend/main.js

// --- ELECTRON AND NODE.JS IMPORTS ---
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // Core Electron modules
const path = require('path'); // Node.js module for handling file paths
const { spawn } = require('child_process'); // Node.js module for creating child processes (to run Python)
const { autoUpdater } = require('electron-updater'); // Handles automatic updates
const fetch = require('node-fetch'); // Used to make HTTP requests from the main process to the Python backend

// --- GLOBAL VARIABLES ---
let mainWindow; // Holds the main application window object.
let pythonProcess = null; // Holds the spawned Python backend process object.
const isDev = process.env.NODE_ENV !== 'production';

// --- PYTHON BACKEND MANAGEMENT ---
/**
 * Starts the Python Flask server as a background child process.
 * This function also sets up listeners to capture the Python process's
 * standard output and standard error for debugging purposes.
 */
function startPythonBackend() {
    // In development, we don't need to bundle the python script.
    // In production, the 'service' directory is at the root of the app resources.
    const scriptPath = isDev
        ? path.join(__dirname, '..', 'service', 'app.py')
        : path.join(process.resourcesPath, 'app', 'service', 'app.py');

    // Determine the correct command to run Python based on the operating system.
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

    console.log(`Starting Python backend with command: ${pythonCommand} ${scriptPath}`);

    pythonProcess = spawn(pythonCommand, [scriptPath]);

    pythonProcess.stdout.on('data', (data) => {
        console.log(`Python Backend: ${data}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python Backend Error: ${data}`);
    });

    pythonProcess.on('close', (code) => {
        console.log(`Python Backend exited with code ${code}`);
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
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    });

    // --- AUTO-UPDATER CONFIGURATION ---
    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'steven-ou',
        repo: 'yt-link',
    });
    
    // Send status updates to the renderer process
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
    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        // In production, load the static HTML file from the 'out' directory.
        const indexPath = path.join(__dirname, 'out', 'index.html');
        mainWindow.loadFile(indexPath);
    }
    
    // After the window is ready, check for updates.
    mainWindow.once('ready-to-show', () => {
      autoUpdater.checkForUpdatesAndNotify();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// --- IPC COMMUNICATION BRIDGE ---
/**
 * Generic handler to forward requests from the renderer to the Python backend.
 * @param {string} endpoint - The API endpoint to call on the Python server.
 * @param {object} body - The JSON body to send with the request.
 * @returns {Promise<object>} - A promise that resolves with the JSON response from the Python server.
 */
async function forwardToPython(endpoint, body) {
    const url = `http://127.0.0.1:8080/${endpoint}`;
    console.log(`[main.js] Forwarding to Python: POST to ${url}`);
    console.log(`[main.js] Body: ${JSON.stringify(body)}`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[main.js] Python service returned an error. Status: ${response.status}, Body: ${errorText}`);
            throw new Error(`Python service error: ${errorText}`);
        }

        const data = await response.json();
        console.log('[main.js] Success response from Python:', data);
        return data;
    } catch (error) {
        console.error('[main.js] CRITICAL: Failed to communicate with Python backend.', error);
        return { error: 'Failed to communicate with the backend service.' };
    }
}

// --- ELECTRON APP LIFECYCLE EVENTS ---
app.on('ready', () => {
    startPythonBackend();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    if (pythonProcess) {
        console.log('Killing Python backend process...');
        pythonProcess.kill();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// --- IPC HANDLERS ---
// These now match the function names and channels defined in preload.js.

ipcMain.handle('start-single-mp3-job', (event, args) => {
    return forwardToPython('start-single-mp3-job', args);
});

ipcMain.handle('start-playlist-zip-job', (event, args) => {
    return forwardToPython('start-playlist-zip-job', args);
});

ipcMain.handle('start-combine-playlist-mp3-job', (event, args) => {
    return forwardToPython('start-combine-playlist-mp3-job', args);
});

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

// Added handler for the restart and install functionality.
ipcMain.on('restart-and-install', () => {
    autoUpdater.quitAndInstall();
});
