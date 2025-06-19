// frontend/main.js

// --- Import necessary modules from Electron and Node.js ---
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // Core Electron modules
const path = require('path'); // Node.js module for handling and transforming file paths.
const { spawn } = require('child_process'); // Node.js module for creating and managing child processes.
const { autoUpdater } = require('electron-updater'); // Handles automatic application updates.
const fetch = require('node-fetch'); // A module for making network requests.
const fs = require('fs'); // Node.js File System module.

// --- Global variables ---
let mainWindow; // Will hold the main window object.
let backendProcess; // Will hold the reference to our Python backend child process.

/**
 * Creates and configures the main application window.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'out/index.html'));
  }
}

/**
 * Starts the Python backend service as a child process.
 */
function startBackend() {
  const isDev = !app.isPackaged;
  let backendExecutablePath;

  if (isDev) {
    // In development, run the python script directly.
    // Make sure your virtual environment is active or python/pip are in your system PATH.
    backendExecutablePath = 'python';
    const scriptPath = path.join(__dirname, '..', 'service', 'app.py');
    backendProcess = spawn(backendExecutablePath, [scriptPath]);
  } else {
    // In production, run the packaged executable.
    const backendName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
    backendExecutablePath = path.join(process.resourcesPath, 'backend', backendName);
    
    try {
        fs.accessSync(backendExecutablePath, fs.constants.X_OK);
        backendProcess = spawn(backendExecutablePath);
    } catch (err) {
        console.error('[Backend Start] CRITICAL: Backend executable not found or not executable.', err);
        dialog.showErrorBox('Backend Error', `The backend executable could not be found or is not executable at ${backendExecutablePath}.`);
        return;
    }
  }

  console.log(`Starting backend executable: ${backendExecutablePath}`);

  // Log output for debugging purposes
  backendProcess.stdout.on('data', (data) => console.log(`[Backend]: ${data.toString()}`));
  backendProcess.stderr.on('data', (data) => console.error(`[Backend Error]: ${data.toString()}`));
  backendProcess.on('close', (code) => console.log(`[Backend] Exited with code ${code}`));
  backendProcess.on('error', (err) => {
    console.error('[Backend Start] CRITICAL: Failed to start backend executable.', err);
    dialog.showErrorBox('Backend Service Error', 'The backend service failed to start. Please check the logs.');
  });
}

// --- Electron App Lifecycle Events ---
app.on('ready', () => {
  startBackend();
  createWindow();
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
  autoUpdater.checkForUpdatesAndNotify();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) {
    console.log('Killing backend process...');
    backendProcess.kill();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- Inter-Process Communication (IPC) ---

/**
 * A generic and secure handler to forward API requests from the UI to the Python backend.
 */
async function forwardToPython(endpoint, body) {
    // Corrected Port: The Python Flask server runs on port 8080.
    const url = `http://127.0.0.1:8080/${endpoint}`;
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Python service error (${response.status}): ${errorText}`);
          throw new Error(`Python service error: ${errorText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`[Main->Python] CRITICAL ERROR:`, error);
        return { error: 'Failed to communicate with the backend service.' };
    }
}

// --- IPC Handlers for Frontend API ---
ipcMain.handle('start-single-mp3-job', (_, args) => forwardToPython('start-single-mp3-job', args));
ipcMain.handle('start-playlist-zip-job', (_, args) => forwardToPython('start-playlist-zip-job', args));
ipcMain.handle('start-combine-playlist-mp3-job', (_, args) => forwardToPython('start-combine-playlist-mp3-job', args));

ipcMain.handle('get-job-status', async (_, jobId) => {
    try {
        // Corrected Port: The Python Flask server runs on port 8080.
        const response = await fetch(`http://127.0.0.1:8080/job-status/${jobId}`);
        if (!response.ok) throw new Error(`Failed to get job status: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error(`[Main->Python] Status Check Error:`, error);
        return { error: 'Failed to get job status.' };
    }
});

ipcMain.handle('save-file', async (event, jobInfo) => {
    if (!jobInfo || !jobInfo.filepath || !jobInfo.filename) {
        return { error: 'Invalid job information provided.' };
    }
    const { filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: jobInfo.filename });
    if (!filePath) {
        return { success: false, reason: 'User cancelled save.' };
    }
    try {
        fs.copyFileSync(jobInfo.filepath, filePath);
        // Optional: Clean up the original file from the temp directory
        fs.unlinkSync(jobInfo.filepath); 
        return { success: true, path: filePath };
    } catch (error) {
        console.error('Failed to save file:', error);
        return { success: false, error: 'Failed to save file.' };
    }
});

ipcMain.on('restart-and-install', () => { autoUpdater.quitAndInstall(); });
