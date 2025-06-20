// --- Electron and Node.js Modules ---
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
// const isDev = require('electron-is-dev'); // REMOVED: This was causing the crash.

// --- Global Configuration ---
const BACKEND_PORT = 8080;
let backendProcess = null;

/**
 * Starts the Python backend executable with extensive logging.
 */
function startBackend() {
  // Use app.isPackaged to determine if we are in development or production.
  // This is the correct, built-in Electron method.
  if (!app.isPackaged) {
    console.log('[main.js] Development mode (app.isPackaged is false): Assuming Python backend is running independently.');
    return;
  }

  // --- Path and Environment Logging ---
  console.log('--- [main.js] Starting Backend Process (Production Mode) ---');
  
  const resourcesPath = process.resourcesPath;
  console.log(`[main.js] process.resourcesPath is: ${resourcesPath}`);

  const backendDir = path.join(resourcesPath, 'backend');
  const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
  const backendPath = path.join(backendDir, backendExecutableName);
  console.log(`[main.js] Calculated backend executable path: ${backendPath}`);

  const backendEnv = {
    ...process.env,
    'YT_LINK_BACKEND_PORT': BACKEND_PORT.toString(),
    'YT_LINK_RESOURCES_PATH': resourcesPath
  };
  
  console.log('[main.js] Spawning process with environment...');

  backendProcess = spawn(backendPath, [], { env: backendEnv });

  // --- Process Event Handling ---
  backendProcess.on('error', (err) => {
    console.error('[main.js] FATAL: Failed to start backend process:', err);
    dialog.showErrorBox('Backend Error', `Failed to start the backend service: ${err.message}`);
  });

  backendProcess.stdout.on('data', (data) => {
    process.stdout.write(`[PYTHON_STDOUT] ${data.toString()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    process.stderr.write(`[PYTHON_STDERR] ${data.toString()}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`[main.js] Backend process exited with code ${code}`);
    if (code !== 0) {
      dialog.showErrorBox('Backend Stopped', `The backend service stopped unexpectedly. Check the console for logs. Code: ${code}`);
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Use app.isPackaged to determine the URL to load.
  if (!app.isPackaged) {
    // Development: Load from the Next.js dev server
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    // Production: Load from the bundled backend server
    const startUrl = `http://localhost:${BACKEND_PORT}`;
    win.loadURL(startUrl).catch(err => {
        console.error('[main.js] Error loading production URL:', err);
        dialog.showErrorBox('Load Error', `Failed to load the application URL: ${startUrl}. Is the backend running?`);
    });
  }

  ipcMain.handle('select-dir', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('open-path-in-explorer', (event, filePath) => {
    require('electron').shell.showItemInFolder(filePath);
  });
}

// --- Electron App Lifecycle Events ---

app.whenReady().then(() => {
  startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (backendProcess) {
    console.log('[main.js] Terminating backend process...');
    backendProcess.kill();
  }
});
