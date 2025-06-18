// Import necessary modules from the Electron library.
const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater'); // Import electron-updater

// Import the 'path' module, a core Node.js library for working with file and directory paths.
const path = require('path');

// Import the 'spawn' function from the 'child_process' module to run external processes, like our Python script.
const { spawn } = require('child_process');

// Import 'node-fetch' to make HTTP requests from the main process to the Python backend.
const fetch = require('node-fetch');

// Check if the application is running in a development environment.
const isDev = process.env.NODE_ENV !== 'production';

// --- HOT RELOADING SECTION ---
if (isDev) {
    try {
        require('electron-reloader')(module);
    } catch (_) {}
}

// Declare a variable to hold the main window instance.
let mainWindow;
// Declare a variable to hold a reference to the Python child process.
let pythonProcess = null;

// This function starts the Python backend service.
function startPythonBackend() {
    // Construct the full, cross-platform path to the Python script in the 'service' directory.
    const scriptPath = isDev 
        ? path.join(__dirname, '..', 'service', 'app.py') 
        : path.join(process.resourcesPath, 'app.asar.unpacked', 'service', 'app.py');

    // Determine the python command based on the OS.
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    
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

// This function creates the main application window.
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 750,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, 'out', 'index.html'));
    }
}

// --- IPC (Inter-Process Communication) Handlers ---
async function handleJobRequest(endpoint, body) {
    try {
        const response = await fetch(`http://127.0.0.1:5001/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'An unknown backend error occurred.');
        }
        return result;

    } catch (error) {
        console.error(`[Main Process Error] Failed to call ${endpoint}:`, error);
        throw new Error(error.message);
    }
}

// --- App Lifecycle Events ---

app.on('ready', () => {
    startPythonBackend();
    createWindow();

    // After the window is created, check for updates.
    // This will automatically download new releases from GitHub.
    autoUpdater.checkForUpdates();
});

// --- Auto-Updater Event Handlers ---
// Listen for auto-updater events and send them to the renderer process (the UI).
autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('update-status', { status: 'available', info });
});

autoUpdater.on('update-not-available', (info) => {
    mainWindow.webContents.send('update-status', { status: 'not-available', info });
});

autoUpdater.on('download-progress', (progressObj) => {
    mainWindow.webContents.send('update-status', { status: 'downloading', progress: progressObj });
});

autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('update-status', { status: 'downloaded', info });
});

autoUpdater.on('error', (err) => {
    mainWindow.webContents.send('update-status', { status: 'error', error: err });
});

// Listen for a message from the UI to quit the app and install the update.
ipcMain.on('restart-and-install', () => {
    autoUpdater.quitAndInstall();
});

// The 'ready' event is fired when Electron has finished initialization.
app.on('ready', () => {
    startPythonBackend();
    ipcMain.handle('start-single-mp3-job', (event, args) => handleJobRequest('start-single-mp3-job', args));
    ipcMain.handle('start-playlist-zip-job', (event, args) => handleJobRequest('start-playlist-zip-job', args));
    ipcMain.handle('start-combine-mp3-job', (event, args) => handleJobRequest('start-combine-playlist-mp3-job', args));
    ipcMain.handle('get-job-status', (event, args) => handleJobRequest('job-status', args));
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('will-quit', () => {
    if (pythonProcess) {
        console.log('Killing Python backend process.');
        pythonProcess.kill();
    }
});
