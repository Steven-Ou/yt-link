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
  // Find an available port to avoid conflicts.
  pythonPort = await portfinder.getPortPromise();

  // In development, we run the .py script directly. In production, we'd run a packaged executable.
  const scriptPath = path.join(__dirname, '../service/app.py');
  const command = 'python';
  const args = [scriptPath, pythonPort.toString()];

  console.log(`Starting backend with command: "${command}" and args: [${args.join(', ')}]`);

  pythonProcess = spawn(command, args);

  // Log output and errors from the Python process for debugging.
  pythonProcess.stdout.on('data', (data) => {
    console.log(`Python stdout: ${data}`);
  });
  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python stderr: ${data}`);
  });
  pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`);
  });
};

/**
 * Creates the main application window.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    webPreferences: {
      // The preload script is crucial for secure IPC.
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // --- Load the application content ---
  if (isDev) {
    // In development, load from the Next.js dev server with a robust retry mechanism.
    const devUrl = 'http://localhost:3000';
    const loadDevUrl = () => {
      console.log(`Attempting to load URL: ${devUrl}`);
      mainWindow.loadURL(devUrl).catch(() => {
        console.error(`Failed to load ${devUrl}. Retrying in 2 seconds...`);
        setTimeout(loadDevUrl, 2000);
      });
    };
    loadDevUrl();
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // In production, load the static HTML file.
    mainWindow.loadFile(path.join(__dirname, 'out/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- IPC (Inter-Process Communication) Handlers ---

// This function forwards a job start request to the Python backend.
const startJob = async (endpoint, data) => {
  if (!pythonPort) throw new Error('Python backend is not available.');
  const url = `http://127.0.0.1:${pythonPort}/${endpoint}`;
  console.log(`Forwarding job to Python: ${url} with data:`, data);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python API Error: ${response.statusText} - ${errorText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error in handler for '${endpoint}':`, error);
    throw error;
  }
};

// --- Electron App Lifecycle Events ---

app.whenReady().then(async () => {
  // Start the backend first.
  await startPythonBackend();

  // --- Register all IPC handlers your app needs ---
  ipcMain.handle('select-directory', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('start-single-mp3-job', (event, data) => startJob('start-single-mp3-job', data));
  ipcMain.handle('start-playlist-zip-job', (event, data) => startJob('start-playlist-zip-job', data));
  ipcMain.handle('start-combine-playlist-mp3-job', (event, data) => startJob('start-combine-playlist-mp3-job', data));
  ipcMain.handle('get-job-status', async (event, jobId) => {
    if (!pythonPort) throw new Error('Python backend is not available.');
    const url = `http://127.0.0.1:${pythonPort}/job-status/${jobId}`;
    const response = await fetch(url);
    return await response.json();
  });
  ipcMain.handle('open-folder', (event, folderPath) => {
    if (folderPath) {
      shell.openPath(folderPath);
    }
  });

  // Now create the application window.
  createWindow();
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// On macOS, re-create a window when the dock icon is clicked and no other windows are open.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Make sure to kill the Python backend when the Electron app quits.
app.on('will-quit', () => {
  if (pythonProcess) {
    console.log('Terminating Python backend process.');
    pythonProcess.kill();
  }
});
