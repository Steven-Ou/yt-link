// frontend/main.js

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fetch = require('node-fetch');

const isDev = process.env.NODE_ENV !== 'production';

// --- HOT RELOADING ---
// This will automatically reload the app when you make changes in development
if (isDev) {
    try {
        // This line enables hot-reloading
        require('electron-reloader')(module);
    } catch (_) {
        // This catch block prevents crashes if the reloader is not found
    }
}

// Keep a reference to the python process to ensure it's killed when the app closes
let pythonProcess = null;

function startPythonBackend() {
    // Correctly locate the python script relative to the main.js file
    const scriptPath = path.join(__dirname, '..', 'service', 'app.py');
    
    // Use 'python3'. If this fails on some systems, it might need to be 'python'.
    pythonProcess = spawn('python3', [scriptPath]);

    // Log output from the Python backend for debugging
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

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1100, // A good size for the sidebar layout
        height: 750,
        webPreferences: {
            // The preload script is the secure bridge between the UI and this main process
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // Load the Next.js URL in development or the static files in production
    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, 'out', 'index.html'));
    }
}

// --- IPC Handlers ---
// This async function is a reusable handler for all requests to the Python backend.
async function handleJobRequest(endpoint, body) {
    try {
        // Forward the request from the UI to the local Python/Flask server
        const response = await fetch(`http://127.0.0.1:5001/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const result = await response.json();

        // If the python server returns an error, pass it back to the UI
        if (!response.ok) {
            throw new Error(result.error || 'An unknown backend error occurred.');
        }

        return result;

    } catch (error) {
        // Log the full error in the main process console (your terminal)
        console.error(`[Main Process Error] Failed to call ${endpoint}:`, error);
        // And re-throw it so the UI's `catch` block can display it to the user
        throw new Error(error.message);
    }
}

// --- App Lifecycle Events ---

// This method will be called when Electron has finished initialization
app.on('ready', () => {
    // Start the python backend service
    startPythonBackend();

    // Define all the API endpoints that the UI can call
    ipcMain.handle('start-single-mp3-job', (event, args) => handleJobRequest('start-single-mp3-job', args));
    ipcMain.handle('start-playlist-zip-job', (event, args) => handleJobRequest('start-playlist-zip-job', args));
    ipcMain.handle('start-combine-mp3-job', (event, args) => handleJobRequest('start-combine-playlist-mp3-job', args));
    ipcMain.handle('get-job-status', (event, args) => handleJobRequest('job-status', args));

    // Create the main application window
    createWindow();
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// On macOS, it's common to re-create a window in the app when the
// dock icon is clicked and there are no other windows open.
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Make sure to kill the python backend process when the Electron app quits
app.on('will-quit', () => {
    if (pythonProcess) {
        console.log('Killing Python backend process.');
        pythonProcess.kill();
    }
});
