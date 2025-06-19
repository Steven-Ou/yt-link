// --- ELECTRON AND NODE.JS IMPORTS ---
// 'app', 'BrowserWindow' for window management.
// 'ipcMain' to listen for events from the renderer process.
// 'dialog' to open native system dialogs (e.g., for selecting a directory).
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); 
const path = require('path');
// 'spawn' to launch the Python backend process.
const { spawn } = require('child_process');
// 'axios' is a modern library for making HTTP requests to the backend.
const axios = require('axios');

// --- GLOBAL VARIABLES ---
let mainWindow;
let backendProcess;
// Define the port for the Python backend. Must match the port in app.py.
const BACKEND_PORT = 5001; 
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

// --- MAIN WINDOW CREATION ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 650,
    height: 730,
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
  if (!app.isPackaged) {
    console.log('DEV MODE: Backend should be started manually.');
    return;
  }
  
  const resourcesPath = process.resourcesPath;
  const backendDir = path.join(resourcesPath, 'backend');
  const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
  const backendPath = path.join(backendDir, backendExecutableName);

  console.log('--- LAUNCHING BACKEND ---');
  console.log(`Full Backend Path: ${backendPath}`);
  
  try {
    // Pass the port to the backend as an environment variable
    backendProcess = spawn(backendPath, [], { env: { ...process.env, 'YT_LINK_BACKEND_PORT': BACKEND_PORT } });
    
    // --- Logging listeners ---
    backendProcess.stdout.on('data', (data) => console.log(`BACKEND_STDOUT: ${data.toString()}`));
    backendProcess.stderr.on('data', (data) => console.error(`BACKEND_STDERR: ${data.toString()}`));
    backendProcess.on('error', (err) => console.error('BACKEND_ERROR: Failed to start backend process.', err));
    backendProcess.on('close', (code) => console.log(`BACKEND_CLOSE: Backend process exited with code ${code}`));

  } catch (error) {
    console.error('SPAWN_ERROR: Critical error spawning backend process.', error);
  }
}

// --- ELECTRON APP LIFECYCLE EVENTS ---
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
    console.log('Terminating backend process...');
    backendProcess.kill();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// --- IPC HANDLERS (THE BRIDGE BETWEEN FRONTEND AND BACKEND) ---

// Handle the request to open a directory selection dialog.
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) {
    return null; // User canceled the dialog
  } else {
    return result.filePaths[0]; // Return the selected directory path
  }
});

// Handle the request to start a single MP3 download job.
ipcMain.handle('start-single-mp3-job', async (event, args) => {
  try {
    const response = await axios.post(`${BACKEND_URL}/start-single-mp3-job`, args);
    return response.data; // Forward the response from the Python backend to the frontend
  } catch (error) {
    console.error('IPC Error (start-single-mp3-job):', error.message);
    return { error: error.message }; // Return error info to the frontend
  }
});

// Handle the request to start a playlist download job.
ipcMain.handle('start-playlist-zip-job', async (event, args) => {
  try {
    const response = await axios.post(`${BACKEND_URL}/start-playlist-zip-job`, args);
    return response.data;
  } catch (error) {
    console.error('IPC Error (start-playlist-zip-job):', error.message);
    return { error: error.message };
  }
});

// Handle the request to get the status of a specific job.
ipcMain.handle('get-job-status', async (event, jobId) => {
  try {
    const response = await axios.get(`${BACKEND_URL}/job-status/${jobId}`);
    return response.data;
  } catch (error) {
    console.error(`IPC Error (get-job-status for ${jobId}):`, error.message);
    return { error: error.message, status: 'failed' };
  }
});

// Handle the request to download a completed file.
ipcMain.handle('download-file', async (event, jobId) => {
  try {
    // This is a simple implementation. A more robust one might stream the file through the main process.
    // For now, we'll just return the URL to the frontend.
    // NOTE: This assumes the frontend can directly access the Flask server, which is true in this setup.
    return { downloadUrl: `${BACKEND_URL}/download/${jobId}` };
  } catch (error) {
    console.error(`IPC Error (download-file for ${jobId}):`, error.message);
    return { error: error.message };
  }
});
