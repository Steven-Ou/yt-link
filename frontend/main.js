const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
// const isDev = require('electron-is-dev'); // REMOVED: This was causing the ESM/CJS conflict.
const { spawn } = require('child_process');
const portfinder = require('portfinder');

let mainWindow;
let pythonProcess;
let pythonPort;

// --- Function to Create the Main Application Window ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  
  // UPDATED: Use app.isPackaged to determine the environment.
  // app.isPackaged is `false` when running from the command line (dev mode)
  // and `true` when running from a packaged application (prod mode).
  // So, `!app.isPackaged` is the new `isDev`.
  const isDev = !app.isPackaged;

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../out/index.html')}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// --- Function to Start the Python Backend Server ---
const startPythonBackend = async () => {
  pythonPort = await portfinder.getPortPromise();
  
  const isDev = !app.isPackaged; // Use the same logic here.

  // Determine path to the Python script/executable.
  const backendExecutable = sys.platform === 'win32' ? 'app.exe' : 'app';
  const backendPath = isDev
    ? path.join(__dirname, '../../service/app.py') // Path to the .py script in dev
    : path.join(process.resourcesPath, 'backend', backendExecutable); // Path to the packaged executable.

  const command = isDev ? 'python' : backendPath;
  const args = [pythonPort.toString()];
  
  console.log(`Starting backend with command: "${command}" and args: [${args.join(', ')}]`);

  // Spawn the child process.
  // In production, the command is the executable itself, so it doesn't need 'script' as an argument.
  pythonProcess = isDev ? spawn(command, [backendPath, ...args]) : spawn(command, args);

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


// --- Electron App Lifecycle ---

app.whenReady().then(async () => {
  // Register IPC handlers BEFORE creating the window to avoid race conditions.
  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (!result.canceled) {
      return result.filePaths[0];
    }
    return null;
  });
  
  ipcMain.handle('get-python-port', () => {
    return pythonPort;
  });

  // Start the backend and then create the main window.
  await startPythonBackend();
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

app.on('will-quit', () => {
  // Ensure the python backend is terminated when the app closes.
  if (pythonProcess) {
    console.log('Terminating Python backend process.');
    pythonProcess.kill();
  }
});
