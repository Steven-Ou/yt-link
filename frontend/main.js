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
  await startPythonBackend();

  // --- Register all IPC handlers ---
  
  // NEWLY ADDED: This handler gets the default downloads folder path.
  ipcMain.handle('get-downloads-path', () => {
    return app.getPath('downloads');
  });

  ipcMain.handle('select-directory', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  
  ipcMain.handle('start-single-mp3-job', async (event, data) => {
    try {
      const result = await startJob('start-single-mp3-job', data);
      return result;
    } catch (error) {
      console.error('[IPC Handler] Critical error in start-single-mp3-job:', error);
      throw error;
    }
  });

  ipcMain.handle('start-playlist-zip-job', async (event, data) => {
      try {
        return await startJob('start-playlist-zip-job', data);
      } catch (error) {
        console.error('[IPC Handler] Error in start-playlist-zip-job:', error);
        throw error;
      }
  });
  
  ipcMain.handle('start-combine-playlist-mp3-job', async (event, data) => {
      try {
        return await startJob('start-combine-playlist-mp3-job', data);
      } catch (error) {
        console.error('[IPC Handler] Error in start-combine-playlist-mp3-job:', error);
        throw error;
      }
  });

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
