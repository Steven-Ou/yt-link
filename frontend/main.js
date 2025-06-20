const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const BACKEND_PORT = 8080;
let backendProcess = null;

// --- IPC Handlers ---
// Moved handlers to the top level to ensure they are only registered ONCE.
// This fixes the "Attempted to register a second handler" crash.
ipcMain.handle('select-dir', async () => {
  // We need a reference to a window to show the dialog.
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return null;

  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-path-in-explorer', (event, filePath) => {
  require('electron').shell.showItemInFolder(filePath);
});


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

  const backendEnv = {
    ...process.env,
    'YT_LINK_BACKEND_PORT': BACKEND_PORT.toString(),
    'YT_LINK_RESOURCES_PATH': resourcesPath
  };
  
  backendProcess = spawn(backendPath, [], { env: backendEnv });

  backendProcess.on('error', (err) => console.error('[main.js] FATAL: Failed to start backend process:', err));
  backendProcess.stdout.on('data', (data) => process.stdout.write(`[PYTHON_STDOUT] ${data.toString()}`));
  backendProcess.stderr.on('data', (data) => process.stderr.write(`[PYTHON_STDERR] ${data.toString()}`));
  backendProcess.on('close', (code) => console.log(`[main.js] Backend process exited with code ${code}`));
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

  const urlToLoad = !app.isPackaged 
    ? 'http://localhost:3000' 
    : `http://localhost:${BACKEND_PORT}`;

  // Retry loading the production URL to give the backend time to start.
  const loadUrlWithRetry = (url, retries = 5, delay = 1000) => {
    win.loadURL(url).catch((err) => {
      console.warn(`[main.js] Failed to load URL: ${url}. Retrying in ${delay}ms... (${retries} retries left)`);
      if (retries > 0) {
        setTimeout(() => loadUrlWithRetry(url, retries - 1, delay), delay);
      } else {
        console.error('[main.js] Could not load URL after multiple retries.', err);
        dialog.showErrorBox('Load Error', `Failed to connect to the backend at ${url}.`);
      }
    });
  };

  loadUrlWithRetry(urlToLoad);

  if (!app.isPackaged) {
      win.webContents.openDevTools();
  }
}

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
    backendProcess.kill();
  }
});
