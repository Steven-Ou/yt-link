/**
 * @file This is the main process file for the Electron application.
 * It's responsible for creating the window, managing the app's lifecycle,
 * and handling all communication with the Python backend.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fetch = require('node-fetch');
const portfinder = require('portfinder');

// --- Global variables ---
let mainWindow;
let pythonProcess;
let pythonPort;

// Check if the app is running in development mode.
const isDev = !app.isPackaged;

/**
 * Starts the Python backend server as a child process.
 */
const startPythonBackend = async () => {
  try {
    // Find an available port to avoid conflicts.
    pythonPort = await portfinder.getPortPromise();

    // In development, we run the .py script directly.
    const scriptPath = path.join(__dirname, '../service/app.py');
    const command = 'python';
    const args = [scriptPath, pythonPort.toString()];

    console.log(`[main.js] Starting backend with command: "${command}" and args: [${args.join(', ')}]`);
    pythonProcess = spawn(command, args);

    // Log output and errors from the Python process for debugging.
    pythonProcess.stdout.on('data', (data) => console.log(`[Python stdout] ${data.toString().trim()}`));
    pythonProcess.stderr.on('data', (data) => console.error(`[Python stderr] ${data.toString().trim()}`));
    pythonProcess.on('close', (code) => console.log(`[main.js] Python process exited with code ${code}`));

  } catch (error) {
    console.error('[main.js] Failed to start Python backend:', error);
  }
};

/**
 * Creates the main application window.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the application content.
  if (isDev) {
    const devUrl = 'http://localhost:3000';
    // This robust retry mechanism prevents blank screens.
    const loadDevUrl = () => {
      console.log(`[main.js] Attempting to load URL: ${devUrl}`);
      mainWindow.loadURL(devUrl).catch(() => {
        console.error(`[main.js] Failed to load ${devUrl}. Retrying in 2 seconds...`);
        setTimeout(loadDevUrl, 2000);
      });
    };
    loadDevUrl();
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'out/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- IPC Handler Function ---
// This function forwards a job start request to the Python backend.
const startJob = async (endpoint, data) => {
  if (!pythonPort) {
    console.error('[main.js startJob] Error: pythonPort is not set.');
    throw new Error('Python backend is not available.');
  }
  const url = `http://127.0.0.1:${pythonPort}/${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[main.js startJob] Python API response not OK: ${errorText}`);
    throw new Error(`Python API Error: ${response.statusText} - ${errorText}`);
  }
  return await response.json();
};

// --- Electron App Lifecycle ---
app.whenReady().then(async () => {
  // Start the backend first.
  await startPythonBackend();

  // --- Register all IPC handlers ---
  // A dedicated try/catch block for each handler ensures maximum stability
  // and prevents silent failures.
  ipcMain.handle('start-single-mp3-job', async (event, data) => {
    try {
      const result = await startJob('start-single-mp3-job', data);
      console.log('[IPC Handler] Successfully returned a Job ID for single-mp3-job.');
      return result;
    } catch (error) {
      console.error('[IPC Handler] Critical error in start-single-mp3-job:', error);
      throw error; // Propagate the error to the UI to be displayed.
    }
  });

  // Add handlers for other job types with the same robust structure.
  ipcMain.handle('start-playlist-zip-job', (event, data) => { /* ... */ });
  ipcMain.handle('start-combine-playlist-mp3-job', (event, data) => { /* ... */ });
  ipcMain.handle('get-job-status', async (event, jobId) => { /* ... */ });
  ipcMain.handle('open-folder', (event, folderPath) => { /* ... */ });

  // Now create the application window.
  createWindow();
});

// --- Quit and Cleanup ---
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
    console.log('[main.js] Terminating Python backend process.');
    pythonProcess.kill();
  }
});
