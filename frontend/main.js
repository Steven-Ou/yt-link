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
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  
  // Use app.isPackaged to determine the environment.
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
  
  const isDev = !app.isPackaged;

  // UPDATED: Correctly use process.platform to check the operating system.
  const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
  
  const backendPath = isDev
    ? path.join(__dirname, '../../service/app.py') // Dev: path to the .py script
    : path.join(process.resourcesPath, 'backend', backendExecutableName); // Prod: path to the packaged executable

  const command = isDev ? 'python' : backendPath;
  const args = [pythonPort.toString()];
  
  console.log(`Starting backend with command: "${command}" and args: [${args.join(', ')}]`);

  // Spawn the child process.
  // In dev, the command is 'python' and the script path is the first argument.
  // In prod, the command is the executable itself.
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
