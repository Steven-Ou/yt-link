const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
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
      // Set webSecurity to true is a security best practice.
      // We will use loadFile to correctly handle local resources.
      webSecurity: true, 
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  
  const isDev = !app.isPackaged;

  // --- UPDATED: Load URL for Dev, Load File for Prod ---
  // This is the critical change to fix the "white screen" and "Not allowed to load local resource" error.
  if (isDev) {
    // In development, we load from the Next.js dev server.
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // In production, we use `loadFile`. This is the recommended and more secure way
    // to load local HTML files, and it correctly handles file-system paths.
    // The path is also corrected from '../out/index.html' to 'out/index.html'
    // to match the file structure in the packaged app.
    mainWindow.loadFile(path.join(__dirname, 'out/index.html'));
  }
}

// --- Function to Start the Python Backend Server ---
const startPythonBackend = async () => {
  pythonPort = await portfinder.getPortPromise();
  
  const isDev = !app.isPackaged;

  const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
  
  const backendPath = isDev
    ? path.join(__dirname, '../../service/app.py') // Dev: path to the .py script
    : path.join(process.resourcesPath, 'backend', backendExecutableName); // Prod: path to the packaged executable

  const command = isDev ? 'python' : backendPath;
  const args = [pythonPort.toString()];
  
  console.log(`Starting backend with command: "${command}" and args: [${args.join(', ')}]`);

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
  // Register IPC handlers BEFORE creating the window.
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
  if (pythonProcess) {
    console.log('Terminating Python backend process.');
    pythonProcess.kill();
  }
});
