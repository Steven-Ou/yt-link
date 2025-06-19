const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const ipc = require('node-ipc');

let mainWindow;
let backendProcess;

// A unique ID for IPC communication
const IPC_ID = 'yt-link-ipc';

ipc.config.id = IPC_ID;
ipc.config.retry = 1500;
ipc.config.silent = true;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 650, // --- SETTING WIDTH ---
    height: 730, // --- SETTING HEIGHT ---
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the Next.js app
  mainWindow.loadURL('http://localhost:3000');

  // Open DevTools (optional, remove for production)
  // mainWindow.webContents.openDevTools();
}

function startBackend() {
  const isDev = process.env.NODE_ENV !== 'production';
  let backendPath;

  if (isDev) {
    // In development, we might run the python script directly
    // This assumes you have a virtual env setup.
    // For simplicity, we'll focus on the production path which is the issue.
    console.log('Running in development mode. Backend should be started manually.');
    return; // Or handle dev startup
  }

  // In production, the executable is packaged.
  const base_path = app.getAppPath().replace('app.asar', '');

  if (process.platform === 'win32') {
    backendPath = path.join(base_path, 'backend', 'yt-link-backend.exe');
  } else {
    // Correct path for macOS
    backendPath = path.join(base_path, 'backend', 'yt-link-backend');
  }

  console.log(`Attempting to start backend at: ${backendPath}`);

  try {
    // Spawn the process
    backendProcess = spawn(backendPath);

    backendProcess.stdout.on('data', (data) => {
      console.log(`Backend stdout: ${data}`);
    });

    backendProcess.stderr.on('data', (data) => {
      console.error(`Backend stderr: ${data}`);
    });

    backendProcess.on('close', (code) => {
      console.log(`Backend process exited with code ${code}`);
    });

    backendProcess.on('error', (err) => {
      console.error('Failed to start backend process:', err);
    });

  } catch (error) {
    console.error('Error spawning backend process:', error);
  }
}


app.on('ready', () => {
  // In a packaged app, we need to start our own backend.
  if (app.isPackaged) {
    startBackend();
  }

  createWindow();

  ipc.connectTo(IPC_ID, () => {
    ipc.of[IPC_ID].on('connect', () => {
      console.log('Successfully connected to IPC network.');
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Kill the backend process when the app is about to quit
  if (backendProcess) {
    console.log('Terminating backend process...');
    backendProcess.kill();
  }
  ipc.disconnect(IPC_ID);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
