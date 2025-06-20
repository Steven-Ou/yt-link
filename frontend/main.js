// --- Electron and Node.js Modules ---
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// --- Global Configuration ---
const BACKEND_PORT = 8080;
let backendProcess = null;

// --- IPC Handlers ---
// These are defined at the top level to ensure they are only registered ONCE.
// This prevents the "Attempted to register a second handler" crash.

// Handles the renderer's request to select a directory.
ipcMain.handle('select-dir', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return null; // Can't show a dialog without a window.

  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Handles opening the file explorer to show the downloaded file.
ipcMain.handle('open-path-in-explorer', (event, filePath) => {
  if (filePath && typeof filePath === 'string') {
    require('electron').shell.showItemInFolder(filePath);
  } else {
    console.error('[main.js] Invalid path provided to open-path-in-explorer:', filePath);
  }
});

// Forwards the job request from the renderer to the Python backend.
ipcMain.handle('start-single-mp3-job', async (event, args) => {
    try {
        const response = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/start-single-mp3-job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args)
        });
        return await response.json();
    } catch (error) {
        console.error('[main.js] Error communicating with backend:', error);
        return { error: 'Could not connect to the backend service.' };
    }
});

// Forwards the job status request from the renderer to the Python backend.
ipcMain.handle('get-job-status', async(event, jobId) => {
    try {
        const response = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/job-status/${jobId}`);
        return await response.json();
    } catch (error) {
        console.error(`[main.js] Error getting status for job ${jobId}:`, error);
        return { status: 'failed', message: 'Could not connect to the backend service.' };
    }
});


/**
 * Starts the Python backend executable when the application is packaged.
 */
function startBackend() {
  // Use `app.isPackaged` - the correct, built-in way to check for production mode.
  // We do NOT start the backend if we are in development.
  if (!app.isPackaged) {
    console.log('[main.js] Development mode: Assuming Python backend is running independently.');
    return;
  }

  console.log('--- [main.js] Starting Backend Process (Production Mode) ---');
  
  const resourcesPath = process.resourcesPath;
  const backendDir = path.join(resourcesPath, 'backend');
  const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
  const backendPath = path.join(backendDir, backendExecutableName);

  console.log(`[main.js] Backend executable path: ${backendPath}`);

  // Pass the resource path and port to the backend via environment variables.
  const backendEnv = {
    ...process.env,
    'YT_LINK_BACKEND_PORT': BACKEND_PORT.toString(),
    'YT_LINK_RESOURCES_PATH': resourcesPath
  };
  
  backendProcess = spawn(backendPath, [], { env: backendEnv });

  // Add detailed logging for the backend process.
  backendProcess.on('error', (err) => console.error('[main.js] FATAL: Failed to start backend process:', err));
  backendProcess.stdout.on('data', (data) => process.stdout.write(`[PYTHON_STDOUT] ${data.toString()}`));
  backendProcess.stderr.on('data', (data) => process.stderr.write(`[PYTHON_STDERR] ${data.toString()}`));
  backendProcess.on('close', (code) => console.log(`[main.js] Backend process exited with code ${code}`));
}

/**
 * Creates and manages the main application window.
 */
function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Use `app.isPackaged` to determine the correct URL to load.
  const urlToLoad = !app.isPackaged 
    ? 'http://localhost:3000' // Development URL from Next.js dev server
    : `http://127.0.0.1:${BACKEND_PORT}`; // Production URL served by Python

  // Add a retry mechanism to handle cases where the backend takes a moment to start.
  const loadUrlWithRetry = (url, retries = 5, delay = 1000) => {
    win.loadURL(url).catch((err) => {
      console.warn(`[main.js] Failed to load URL: ${url}. Retrying in ${delay}ms... (${retries} retries left)`);
      if (retries > 0) {
        setTimeout(() => loadUrlWithRetry(url, retries - 1, delay), delay);
      } else {
        console.error('[main.js] Could not load URL after multiple retries.', err);
        dialog.showErrorBox('Application Load Error', `Failed to connect to the backend service at ${url}. Please restart the application.`);
      }
    });
  };

  loadUrlWithRetry(urlToLoad);

  // Open DevTools automatically in development.
  if (!app.isPackaged) {
      win.webContents.openDevTools();
  }
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

// Ensure the backend process is terminated when the app quits.
app.on('quit', () => {
  if (backendProcess) {
    console.log('[main.js] Terminating backend process...');
    backendProcess.kill();
  }
});
