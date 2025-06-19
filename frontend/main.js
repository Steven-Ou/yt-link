// --- ELECTRON AND NODE.JS IMPORTS ---
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); 
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const fs = require('fs'); // Import the file system module

// --- GLOBAL VARIABLES ---
let mainWindow;
let backendProcess;
const BACKEND_PORT = 5001; 
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

// This map will store the temporary path of completed files.
const completedFilePaths = new Map();

// --- MAIN WINDOW CREATION ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024, // Adjusted for the new UI
    height: 768, // Adjusted for the new UI
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

// --- PYTHON BACKEND LAUNCHER ---
function startBackend() {
  if (!app.isPackaged) { return; }
  const resourcesPath = process.resourcesPath;
  const backendDir = path.join(resourcesPath, 'backend');
  const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
  const backendPath = path.join(backendDir, backendExecutableName);
  backendProcess = spawn(backendPath, [], { env: { ...process.env, 'YT_LINK_BACKEND_PORT': BACKEND_PORT } });
  backendProcess.stdout.on('data', (data) => console.log(`BACKEND_STDOUT: ${data.toString()}`));
  backendProcess.stderr.on('data', (data) => console.error(`BACKEND_STDERR: ${data.toString()}`));
}

// --- ELECTRON APP LIFECYCLE EVENTS ---
app.on('ready', () => { startBackend(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { if (backendProcess) backendProcess.kill(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// --- IPC HANDLERS ---
const jobHandlers = {
  'start-single-mp3-job': `${BACKEND_URL}/start-single-mp3-job`,
  'start-playlist-zip-job': `${BACKEND_URL}/start-playlist-zip-job`,
  'start-combine-playlist-mp3-job': `${BACKEND_URL}/start-combine-playlist-mp3-job`,
};

for (const channel in jobHandlers) {
  ipcMain.handle(channel, async (event, args) => {
    try {
      const response = await axios.post(jobHandlers[channel], args);
      return response.data;
    } catch (error) {
      return { error: error.message };
    }
  });
}

ipcMain.handle('get-job-status', async (event, jobId) => {
  try {
    const response = await axios.get(`${BACKEND_URL}/job-status/${jobId}`);
    // If the job is complete, store the temporary file path received from the backend.
    if (response.data.status === 'completed' && response.data.result_path) {
      completedFilePaths.set(jobId, response.data.result_path);
    }
    return response.data;
  } catch (error) {
    return { error: error.message, status: 'failed' };
  }
});

// --- NEW FILE SAVING HANDLER ---
ipcMain.handle('save-completed-file', async (event, jobId) => {
  const tempPath = completedFilePaths.get(jobId);
  if (!tempPath || !fs.existsSync(tempPath)) {
    return { error: 'File not found or already moved.' };
  }

  // Open a "Save As..." dialog, suggesting the original filename.
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.basename(tempPath)
  });

  if (canceled || !filePath) {
    return { error: 'Save was cancelled.' };
  }

  // Copy the file from the temporary location to the user's chosen location.
  try {
    fs.copyFileSync(tempPath, filePath);
    fs.unlinkSync(tempPath); // Clean up the temporary file
    completedFilePaths.delete(jobId); // Remove from our map
    return { success: true, path: filePath };
  } catch (error) {
    console.error("File save error:", error);
    return { error: 'Failed to save the file.' };
  }
});
