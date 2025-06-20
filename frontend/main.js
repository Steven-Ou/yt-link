const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const { spawn } = require('child_process');
const portfinder = require('portfinder');
const fetch = require('node-fetch');

let mainWindow;
let pythonProcess;
let pythonPort;

// --- Function to Create the Main Application Window ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // The preload script is essential for secure communication
      // between the main process (Node.js) and the renderer process (React).
      preload: path.join(__dirname, 'preload.js'),
      // It's recommended to keep contextIsolation enabled for security.
      contextIsolation: true,
      // It's recommended to keep nodeIntegration disabled for security.
      nodeIntegration: false,
    },
  });

  // Determine the URL to load. In development, it's the local Next.js server.
  // In production, it's the static HTML file built by Next.js.
  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../out/index.html')}`;

  mainWindow.loadURL(startUrl);

  // Open DevTools automatically if in development mode.
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// --- Function to Start the Python Backend Server ---
// We need to find an open port and then start the Python Flask server.
const startPythonBackend = async () => {
  // Find an available port to avoid conflicts.
  pythonPort = await portfinder.getPortPromise();
  
  // UPDATED: Define the path to the Python executable.
  // In development, we can assume 'python' is in the PATH.
  // In production (packaged app), the executable is bundled inside the app's resources.
  const backendPath = isDev
    ? path.join(__dirname, '../../service/app.py') // Path to the .py script in dev
    : path.join(process.resourcesPath, 'backend', 'app.exe' ); // Path to the packaged .exe in production
  
  const scriptToRun = isDev ? [backendPath, pythonPort] : [pythonPort];
  const command = isDev ? 'python' : backendPath;

  console.log(`Starting backend: ${command} with args: ${scriptToRun}`);
  
  // Spawn the child process.
  pythonProcess = spawn(command, scriptToRun);

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

// This method is called when Electron has finished initialization and is ready
// to create browser windows. Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // --- IPC HANDLER REGISTRATION ---
  // IMPORTANT: Register all IPC handlers BEFORE creating the window.
  // This prevents a race condition where the renderer process tries to call an IPC
  // function before the main process has registered it. This fixes the
  // "No handler registered for 'select-directory'" error.
  ipcMain.handle('select-directory', async () => {
    // This function is called from the renderer process (your React app)
    // when the user wants to select a download folder.
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    // If the user didn't cancel the dialog, return the selected path.
    if (!result.canceled) {
      return result.filePaths[0];
    }
    return null; // Return null if canceled.
  });
  
  // Add a handler to get the python port
  ipcMain.handle('get-python-port', () => {
    return pythonPort;
  });

  // First, start the backend server.
  await startPythonBackend();

  // Now that handlers are registered and the backend is starting, create the main window.
  createWindow();

  app.on('activate', () => {
    // On macOS, it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// This is the final cleanup step. When the Electron app quits,
// we must make sure to terminate the Python backend process as well.
app.on('will-quit', () => {
  if (pythonProcess) {
    console.log('Terminating Python backend process.');
    pythonProcess.kill();
  }
});