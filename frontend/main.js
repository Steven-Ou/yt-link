// --- ELECTRON AND NODE.JS IMPORTS ---
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const fetch = require('node-fetch');

// --- GLOBAL VARIABLES ---
let mainWindow;
let pythonProcess = null;

// --- PYTHON BACKEND MANAGEMENT ---
/**
 * Starts the Python Flask server as a background child process.
 */
function startPythonBackend() {
    const servicePath = path.join(process.resourcesPath, 'service');
    const scriptPath = path.join(servicePath, 'app.py');
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

    console.log(`[Python Start] Attempting to run: ${pythonCommand} at ${scriptPath}`);
    pythonProcess = spawn(pythonCommand, [scriptPath]);

    // **THE FIX IS HERE:** Add a listener for the 'error' event.
    // This is crucial for catching cases where the process fails to spawn at all
    // (e.g., 'python3' command not found on the user's system).
    pythonProcess.on('error', (err) => {
        console.error('[Python Start] CRITICAL: Failed to start Python backend process.', err);
        // Show a more informative error dialog to the end-user.
        dialog.showErrorBox(
            'Backend Service Error',
            'The required backend service could not be started. This can happen if Python 3 is not installed or not in your system PATH. Please contact support.'
        );
    });

    // Existing listeners for output streams
    pythonProcess.stdout.on('data', (data) => console.log(`[Python Backend]: ${data.toString()}`));
    pythonProcess.stderr.on('data', (data) => console.error(`[Python Backend Error]: ${data.toString()}`));
    pythonProcess.on('close', (code) => console.log(`[Python Backend] Exited with code ${code}`));
}


// --- ELECTRON WINDOW CREATION ---
function createWindow() {
    const isDev = !app.isPackaged;

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    const startUrl = isDev
        ? 'http://localhost:3000'
        : `file://${path.join(__dirname, 'out/index.html')}`;

    mainWindow.loadURL(startUrl);

    if (isDev) {
        mainWindow.webContents.openDevTools();
    } else {
        autoUpdater.on('update-available', () => mainWindow.webContents.send('update-status', 'Update available.'));
        autoUpdater.on('update-downloaded', () => mainWindow.webContents.send('update-status', 'Update downloaded. Click restart to install.'));
        mainWindow.once('ready-to-show', () => {
            autoUpdater.checkForUpdatesAndNotify();
        });
    }
    
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// --- IPC AND APP LIFECYCLE (No changes below) ---

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

app.on('ready', () => {
    if (app.isPackaged) {
      startPythonBackend();
    }
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    if (pythonProcess) {
        pythonProcess.kill();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

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
