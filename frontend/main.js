// --- ELECTRON AND NODE.JS IMPORTS ---
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const fs = require('fs');

// --- GLOBAL VARIABLES ---
let mainWindow;
let backendProcess;
const BACKEND_PORT = 5001; // Ensure this matches the port in app.py
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const completedFilePaths = new Map();

// --- IPC HANDLERS (Moved to top level to prevent re-registration) ---

// Handles the 'select-directory' request from the frontend.
ipcMain.handle('select-directory', async () => {
    // The dialog needs to be attached to a window. Get the current one.
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return null; // Can't show a dialog if there's no window.

    const result = await dialog.showOpenDialog(window, {
        properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null; // Return null if the user cancels.
    }
    return result.filePaths[0]; // Otherwise, return the selected folder path.
});

// A map to associate IPC channels with backend API endpoints for cleanliness.
const jobHandlers = {
  'start-single-mp3-job': `${BACKEND_URL}/start-single-mp3-job`,
  'start-playlist-zip-job': `${BACKEND_URL}/start-playlist-zip-job`,
  'start-combine-playlist-mp3-job': `${BACKEND_URL}/start-combine-playlist-mp3-job`,
};

// Loop through the handlers to create an IPC listener for each job type.
// This is more robust than creating separate listeners for each.
for (const channel in jobHandlers) {
  ipcMain.handle(channel, async (event, args) => {
    try {
      console.log(`[IPC] Forwarding request on channel '${channel}' to ${jobHandlers[channel]}`);
      const response = await axios.post(jobHandlers[channel], args);
      return response.data; // Return the backend's response (e.g., a job_id) to the frontend.
    } catch (error) {
      const errorMessage = error.response ? error.response.data : error.message;
      console.error(`[IPC] Error on channel ${channel}:`, errorMessage);
      // Return a structured error object to the frontend.
      return { error: `Failed to communicate with backend: ${errorMessage}` };
    }
  });
}

// Handles polling for job status from the frontend.
ipcMain.handle('get-job-status', async (event, jobId) => {
  try {
    const response = await axios.get(`${BACKEND_URL}/job-status/${jobId}`);
    // If the job is complete and has a result, temporarily store the file path.
    if (response.data.status === 'completed' && response.data.result_path) {
      completedFilePaths.set(jobId, response.data.result_path);
    }
    return response.data;
  } catch (error) {
    const errorMessage = error.response ? error.response.data.error : error.message;
    console.error(`[IPC] Error getting status for job ${jobId}:`, errorMessage);
    return { error: errorMessage, status: 'failed' };
  }
});

// Handles the final step: saving the completed file from its temp location to a user-chosen destination.
ipcMain.handle('save-completed-file', async (event, jobId) => {
  const tempPath = completedFilePaths.get(jobId);
  if (!tempPath || !fs.existsSync(tempPath)) {
    console.error(`[IPC] Save request for job ${jobId} failed: temp file not found at ${tempPath}`);
    return { error: 'File not found. It might have been moved or the job failed.' };
  }

  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return { error: "No window available to show save dialog."};

  // Show the native "Save As..." dialog.
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    defaultPath: path.basename(tempPath)
  });

  if (canceled || !filePath) {
    return { success: false, cancelled: true };
  }

  // Copy the file and then clean up.
  try {
    fs.copyFileSync(tempPath, filePath);
    fs.unlinkSync(tempPath); 
    completedFilePaths.delete(jobId);
    return { success: true, path: filePath };
  } catch (error) {
    console.error(`[IPC] File save error for job ${jobId}:`, error);
    return { error: 'Failed to save the file.' };
  }
});


// --- MAIN APPLICATION LOGIC ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, 'out', 'index.html'));
  } else {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  }
}

function startBackend() {
    // This logic remains the same: only launch the backend in a packaged app.
    if (!app.isPackaged) { return; }

    const resourcesPath = process.resourcesPath;
    const backendDir = path.join(resourcesPath, 'backend');
    const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
    const backendPath = path.join(backendDir, backendExecutableName);
  
    // Pass the Port as an environment variable.
    backendProcess = spawn(backendPath, [], { env: { ...process.env, 'YT_LINK_BACKEND_PORT': BACKEND_PORT.toString() } });
  
    backendProcess.stdout.on('data', (data) => console.log(`BACKEND_STDOUT: ${data.toString()}`));
    backendProcess.stderr.on('data', (data) => console.error(`BACKEND_STDERR: ${data.toString()}`));
}


// --- ELECTRON APP LIFECYCLE ---
app.on('ready', () => {
  startBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});