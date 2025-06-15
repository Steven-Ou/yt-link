// frontend/main.js

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fetch = require('node-fetch'); // Make sure to `npm install node-fetch@2` in your /frontend directory

const isDev = process.env.NODE_ENV !== 'production';

// Keep a reference to the python process
let pythonProcess = null;

function startPythonBackend() {
    // In production, the Python executable will be packaged. 
    // In development, we run the script directly.
    // This path needs to be adjusted based on your final packaging structure.
    const scriptPath = path.join(__dirname, '..', 'service', 'app.py');

    // Use 'python' or 'python3' depending on your system setup.
    // Or point to a venv python executable.
    pythonProcess = spawn('python3', [scriptPath]);

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
        width: 800,
        height: 600,
        webPreferences: {
            // The preload script is essential for secure communication between main and renderer processes
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, // Recommended for security
            nodeIntegration: false, // Recommended for security
        },
    });

    // Load the Next.js app
    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        // In production, load the exported static files
        mainWindow.loadFile(path.join(__dirname, 'out', 'index.html'));
    }
}

// --- IPC Handlers ---
// This is where the UI sends requests to. We use ipcMain.handle for async operations.
// It allows us to return a promise and properly catch errors.

async function handleJobRequest(endpoint, body) {
    try {
        // We forward the request from the UI to the Python backend
        const response = await fetch(`http://127.0.0.1:5001/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const result = await response.json();

        if (!response.ok) {
            // If the server responded with an error status, throw an error
            // with the message from the backend.
            throw new Error(result.error || 'An unknown backend error occurred.');
        }

        return result;

    } catch (error) {
        // This is the CRITICAL part for error handling.
        // 1. Log the full error to the Electron main console (your terminal)
        console.error(`[Main Process Error] Failed to call ${endpoint}:`, error);
        
        // 2. Re-throw the error. ipcMain.handle will automatically pass this
        //    rejection to the renderer process, where it can be caught.
        throw new Error(error.message);
    }
}


// --- App Lifecycle ---

app.on('ready', () => {
    startPythonBackend();

    // Setup IPC handlers
    ipcMain.handle('start-single-mp3-job', (event, args) => handleJobRequest('start-single-mp3-job', args));
    ipcMain.handle('start-playlist-zip-job', (event, args) => handleJobRequest('start-playlist-zip-job', args));
    // Add other handlers here if needed, e.g., for job status
    ipcMain.handle('get-job-status', (event, args) => handleJobRequest('job-status', args));

    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    // Ensure the python process is killed when the app quits
    if (pythonProcess) {
        console.log('Killing Python backend process.');
        pythonProcess.kill();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
