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

const isDev = !app.isPackaged;

/**
 * Starts the Python backend server as a child process.
 * This function now handles both development and packaged (production) environments.
 */
const startPythonBackend = async () => {
  try {
    pythonPort = await portfinder.getPortPromise();

    let command;
    let args;
    const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
    
    // In production, the backend is in the 'resources' folder.
    // In development, we use a path relative to this main.js file.
    const backendPath = isDev 
      ? path.join(__dirname, '..', 'service', 'app.py')
      : path.join(process.resourcesPath, 'backend', backendExecutableName);

    if (isDev) {
      command = 'python';
      // In dev, we pass the resources path manually for consistency.
      args = [backendPath, pythonPort.toString(), path.join(__dirname, '..')];
    } else {
      command = backendPath;
      // *** THIS IS THE CRUCIAL FIX ***
      // In production, pass the location of the resources folder to the python script.
      args = [pythonPort.toString(), process.resourcesPath];
    }

    console.log(`[main.js] Starting backend with: ${command} ${args.join(' ')}`);
    pythonProcess = spawn(command, args);

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

  if (isDev) {
    const devUrl = 'http://localhost:3000';
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
    // In production, load from the static 'out' directory.
    mainWindow.loadFile(path.join(__dirname, 'out/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// NOTE: The 'startJob' function that was here previously is no longer needed,
// as the python script now gets the resource path on startup.
// We can simplify the IPC handlers to pass data directly.

// --- Electron App Lifecycle ---
app.whenReady().then(async () => {
  await startPythonBackend();

  // --- Register all IPC handlers ---
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
  
  const makeApiCall = async (endpoint, data) => {
      if (!pythonPort) throw new Error('Python backend is not available.');
      const url = `http://127.0.0.1:${pythonPort}/${endpoint}`;
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
  };
  
  ipcMain.handle('start-single-mp3-job', (event, data) => makeApiCall('start-single-mp3-job', data));
  ipcMain.handle('start-playlist-zip-job', (event, data) => makeApiCall('start-playlist-zip-job', data));
  ipcMain.handle('start-combine-playlist-mp3-job', (event, data) => makeApiCall('start-combine-playlist-mp3-job', data));

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
