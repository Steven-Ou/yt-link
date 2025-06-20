// --- Electron and Node.js Modules ---
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// --- Global Configuration ---
const BACKEND_PORT = 8080;
let backendProcess = null;

// --- IPC Handlers (Listeners for the Frontend) ---
// These are now defined globally and registered once when the app is ready.
// This permanently fixes the "second handler" and "no handler registered" errors.

function setupIpcHandlers() {
  // Handles the request to open a folder selection dialog.
  ipcMain.handle('select-dir', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  // Gets the default 'Downloads' folder path from the OS.
  ipcMain.handle('get-downloads-path', () => {
    return app.getPath('downloads');
  });

  // Securely opens the file explorer to the specified path.
  ipcMain.handle('open-path-in-explorer', (event, filePath) => {
    if (filePath && typeof filePath === 'string') {
      require('electron').shell.showItemInFolder(filePath);
    }
  });

  // A single, robust handler for starting any type of job.
  ipcMain.handle('start-job', async (event, jobType, args) => {
    try {
      const response = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/${jobType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
      if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(errorBody.error || `HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`[main.js] Error starting job '${jobType}':`, error);
      return { error: `Could not connect to the backend: ${error.message}` };
    }
  });

  // A single handler for checking any job's status.
  ipcMain.handle('get-job-status', async (event, jobId) => {
    try {
      const response = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/job-status/${jobId}`);
      return await response.json();
    } catch (error) {
      console.error(`[main.js] Error getting status for job ${jobId}:`, error);
      return { status: 'failed', message: 'Could not connect to the backend service.' };
    }
  });
}


/**
 * Starts the Python backend executable when the application is packaged.
 */
function startBackend() {
  if (!app.isPackaged) {
    console.log('[main.js] Development mode: Assuming Python backend is running independently.');
    return;
  }
  console.log('--- [main.js] Starting Backend Process (Production Mode) ---');
  const resourcesPath = process.resourcesPath;
  const backendDir = path.join(resourcesPath, 'backend');
  const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
  const backendPath = path.join(backendDir, backendExecutableName);
  const backendEnv = { ...process.env, 'YT_LINK_BACKEND_PORT': BACKEND_PORT.toString(), 'YT_LINK_RESOURCES_PATH': resourcesPath };
  
  backendProcess = spawn(backendPath, [], { env: backendEnv });
  backendProcess.on('error', (err) => console.error('[main.js] FATAL: Failed to start backend:', err));
  backendProcess.stdout.on('data', (data) => process.stdout.write(`[PYTHON] ${data}`));
  backendProcess.stderr.on('data', (data) => process.stderr.write(`[PYTHON_ERR] ${data}`));
  backendProcess.on('close', (code) => console.log(`[main.js] Backend exited with code ${code}`));
}

/**
 * Creates and manages the main application window.
 */
function createWindow() {
  const win = new BrowserWindow({
    width: 800, height: 700,
    webPreferences: {
      // The preload script is the bridge to the main process.
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  const urlToLoad = !app.isPackaged ? 'http://localhost:3000' : `http://127.0.0.1:${BACKEND_PORT}`;

  const loadUrlWithRetry = (url, retries = 5, delay = 1000) => {
    win.loadURL(url).catch((err) => {
      console.warn(`[main.js] Failed to load URL, retrying... (${retries})`);
      if (retries > 0) setTimeout(() => loadUrlWithRetry(url, retries - 1, delay), delay);
      else dialog.showErrorBox('Application Load Error', `Failed to connect to the backend at ${url}.`);
    });
  };
  loadUrlWithRetry(urlToLoad);

  if (!app.isPackaged) win.webContents.openDevTools();
}

// --- Electron App Lifecycle Events ---

app.whenReady().then(() => {
  setupIpcHandlers(); // Set up all listeners.
  startBackend();
  createWindow();
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('quit', () => backendProcess && backendProcess.kill());
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
