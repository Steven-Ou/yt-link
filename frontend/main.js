const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;

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

  // In production, the app is served from the 'out' directory.
  // In development, it connects to the Next.js dev server.
  if (app.isPackaged) {
    // This is a common pattern for Next.js static exports in Electron.
    // Ensure your `next export` command outputs to the 'out' directory.
    // The build script in package.json seems correct.
    mainWindow.loadFile(path.join(__dirname, 'out', 'index.html'));
  } else {
    mainWindow.loadURL('http://localhost:3000');
    // Open DevTools automatically in development
    mainWindow.webContents.openDevTools();
  }
}

function startBackend() {
  // The backend should only be started by Electron in a packaged app.
  if (!app.isPackaged) {
    console.log('DEV MODE: Backend should be started manually.');
    return;
  }

  // Determine the correct path to the backend executable
  const resourcesPath = process.resourcesPath; // This is the correct way to get the resources path in a packaged app
  const backendDir = path.join(resourcesPath, 'backend');
  const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
  const backendPath = path.join(backendDir, backendExecutableName);

  console.log('--- LAUNCHING BACKEND ---');
  console.log(`Resource Path: ${resourcesPath}`);
  console.log(`Full Backend Path: ${backendPath}`);
  
  try {
    // Launch the backend executable
    backendProcess = spawn(backendPath);

    // --- VERY IMPORTANT LOGGING ---
    // Listen for any data output from the backend
    backendProcess.stdout.on('data', (data) => {
      console.log(`BACKEND_STDOUT: ${data.toString()}`);
    });

    // Listen for any error output from the backend
    backendProcess.stderr.on('data', (data) => {
      console.error(`BACKEND_STDERR: ${data.toString()}`);
    });

    // Listen for an error event on the process itself (e.g., failed to spawn)
    backendProcess.on('error', (err) => {
      console.error('BACKEND_ERROR: Failed to start backend process.', err);
    });

    // Listen for when the process exits
    backendProcess.on('close', (code) => {
      console.log(`BACKEND_CLOSE: Backend process exited with code ${code}`);
    });
    // --- END OF LOGGING ---

  } catch (error) {
    console.error('SPAWN_ERROR: Critical error spawning backend process.', error);
  }
}

app.on('ready', () => {
  startBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Kill the backend process when the app quits
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
