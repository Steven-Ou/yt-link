// --- ELECTRON AND NODE.JS IMPORTS ---
// app: Manages the application's lifecycle.
// BrowserWindow: Creates and controls application windows.
// ipcMain: Handles asynchronous and synchronous messages sent from a renderer process (web page).
// dialog: Allows you to display native system dialogs for opening and saving files, alerting, etc.
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); 
// path: Provides utilities for working with file and directory paths in a cross-platform way.
const path = require('path');
// spawn: Used to launch child processes asynchronously, perfect for running our Python backend.
const { spawn } = require('child_process');
// axios: A promise-based HTTP client for making requests to our Python backend.
const axios = require('axios');
// fs: The Node.js File System module, used here for copying the final downloaded file.
const fs = require('fs');

// --- GLOBAL VARIABLES ---
// Will hold the reference to the main application window object.
let mainWindow;
// Will hold the reference to the spawned Python backend process.
let backendProcess;
// The port the Python/Flask backend will run on. This must match the port in app.py.
const BACKEND_PORT = 5001; 
// The base URL for making API requests to the Python backend.
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
// A Map to temporarily store the path of a completed file, keyed by its job ID.
const completedFilePaths = new Map();

// --- MAIN WINDOW CREATION ---
// This function initializes the main application window.
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024, // Set initial window width for the new UI.
    height: 768, // Set initial window height for the new UI.
    webPreferences: {
      // The preload script is a bridge between Node.js and the renderer's web content.
      preload: path.join(__dirname, 'preload.js'),
      // For security, contextIsolation is enabled, ensuring preload scripts and renderer content have separate contexts.
      contextIsolation: true,
      // nodeIntegration is disabled to prevent the renderer from having direct access to Node.js APIs.
      nodeIntegration: false,
    },
  });

  // Load the correct frontend content based on the environment.
  if (app.isPackaged) {
    // In a production build, load the static HTML file from the 'out' directory.
    mainWindow.loadFile(path.join(__dirname, 'out', 'index.html'));
  } else {
    // In development, connect to the Next.js live development server.
    mainWindow.loadURL('http://localhost:3000');
    // And open the developer tools for easy debugging.
    mainWindow.webContents.openDevTools();
  }
}

// --- PYTHON BACKEND LAUNCHER ---
// This function finds and starts the Python backend executable.
function startBackend() {
  // Only start the backend if the app is packaged. In dev, we run it manually.
  if (!app.isPackaged) { return; }
  // process.resourcesPath is the reliable way to find the app's resource directory.
  const resourcesPath = process.resourcesPath;
  const backendDir = path.join(resourcesPath, 'backend');
  const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
  const backendPath = path.join(backendDir, backendExecutableName);
  
  // Spawn the backend process. Pass the port number as an environment variable.
  backendProcess = spawn(backendPath, [], { env: { ...process.env, 'YT_LINK_BACKEND_PORT': BACKEND_PORT } });
  
  // Log any output from the backend for debugging.
  backendProcess.stdout.on('data', (data) => console.log(`BACKEND_STDOUT: ${data.toString()}`));
  backendProcess.stderr.on('data', (data) => console.error(`BACKEND_STDERR: ${data.toString()}`));
}

// --- ELECTRON APP LIFECYCLE EVENTS ---
app.on('ready', () => { startBackend(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { if (backendProcess) backendProcess.kill(); }); // Clean up the backend process.
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// --- IPC HANDLERS (THE BRIDGE BETWEEN FRONTEND AND MAIN PROCESS) ---

// Handles the 'select-directory' request from the frontend.
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null; // Return null if the user cancels.
  }
  return result.filePaths[0]; // Otherwise, return the selected folder path.
});

// A map to associate IPC channels with backend API endpoints.
const jobHandlers = {
  'start-single-mp3-job': `${BACKEND_URL}/start-single-mp3-job`,
  'start-playlist-zip-job': `${BACKEND_URL}/start-playlist-zip-job`,
  'start-combine-playlist-mp3-job': `${BACKEND_URL}/start-combine-playlist-mp3-job`,
};

// Loop through the handlers to create an IPC listener for each job type.
for (const channel in jobHandlers) {
  ipcMain.handle(channel, async (event, args) => {
    try {
      // Forward the request from the frontend to the Python backend using axios.
      const response = await axios.post(jobHandlers[channel], args);
      return response.data; // Return the backend's response to the frontend.
    } catch (error) {
      console.error(`Error on channel ${channel}:`, error.response ? error.response.data : error.message);
      return { error: error.message };
    }
  });
}

// Handles polling for job status.
ipcMain.handle('get-job-status', async (event, jobId) => {
  try {
    const response = await axios.get(`${BACKEND_URL}/job-status/${jobId}`);
    // If the job is complete, store its temporary file path for the final save step.
    if (response.data.status === 'completed' && response.data.result_path) {
      completedFilePaths.set(jobId, response.data.result_path);
    }
    return response.data;
  } catch (error) {
    return { error: error.message, status: 'failed' };
  }
});

// Handles saving the completed file to a user-specified location.
ipcMain.handle('save-completed-file', async (event, jobId) => {
  const tempPath = completedFilePaths.get(jobId);
  if (!tempPath || !fs.existsSync(tempPath)) {
    return { error: 'File not found or already moved.' };
  }

  // Show the native "Save As..." dialog.
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.basename(tempPath) // Suggest the original filename.
  });

  if (canceled || !filePath) {
    return { error: 'Save was cancelled.' };
  }

  // If a path was chosen, copy the file and then clean up the temporary version.
  try {
    fs.copyFileSync(tempPath, filePath);
    fs.unlinkSync(tempPath); 
    completedFilePaths.delete(jobId);
    return { success: true, path: filePath };
  } catch (error) {
    console.error("File save error:", error);
    return { error: 'Failed to save the file.' };
  }
});
