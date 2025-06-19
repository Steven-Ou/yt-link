// --- Electron and Node.js Modules ---
// Import necessary modules from Electron and Node.js.
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // Core Electron modules for app lifecycle, windows, IPC, and dialogs.
const path = require('path'); // Node.js module for handling and transforming file paths.
const { spawn } = require('child_process'); // Node.js module for spawning child processes (our Python backend).
const isDev = require('electron-is-dev'); // Utility to check if the app is running in development mode.

// --- Global Configuration ---
// Define a constant port for the backend server to run on.
const BACKEND_PORT = 8080;
// Keep a global reference to the backend process object to manage its lifecycle.
let backendProcess = null;

/**
 * Starts the Python backend executable.
 * This function handles the logic for both development and production environments.
 */
function startBackend() {
  // In development, we assume the developer is running the Python backend manually.
  // This allows for faster iteration and debugging of the backend service.
  if (isDev) {
    console.log('Development mode: Assuming Python backend is running independently.');
    return;
  }

  // In a packaged (production) application, we must spawn the bundled backend executable.
  // 'process.resourcesPath' gives the absolute path to the 'resources' directory,
  // which is where packaged assets and executables are stored.
  const resourcesPath = process.resourcesPath;
  const backendDir = path.join(resourcesPath, 'backend');
  
  // Determine the correct executable name based on the operating system.
  const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
  const backendPath = path.join(backendDir, backendExecutableName);

  console.log(`Attempting to start backend at: ${backendPath}`);

  // **CRITICAL STEP**: We create a new environment object for the backend process.
  // We pass the 'resourcesPath' as an environment variable ('YT_LINK_RESOURCES_PATH').
  // This allows the Python script to reliably find its dependencies (like ffmpeg)
  // within the packaged application structure.
  const backendEnv = {
    ...process.env, // Inherit the current environment variables.
    'YT_LINK_BACKEND_PORT': BACKEND_PORT.toString(),
    'YT_LINK_RESOURCES_PATH': resourcesPath
  };

  // Spawn the Python executable as a child process with the specified environment.
  backendProcess = spawn(backendPath, [], { env: backendEnv });

  // --- Process Event Handling ---
  // Listen for errors that prevent the process from starting.
  backendProcess.on('error', (err) => {
    console.error('Failed to start backend process:', err);
    dialog.showErrorBox('Backend Error', `Failed to start the backend service: ${err.message}`);
  });

  // Log standard output from the backend for debugging.
  backendProcess.stdout.on('data', (data) => {
    console.log(`BACKEND_STDOUT: ${data.toString().trim()}`);
  });

  // Log standard error from the backend for debugging.
  backendProcess.stderr.on('data', (data) => {
    console.error(`BACKEND_STDERR: ${data.toString().trim()}`);
  });

  // Handle the backend process closing unexpectedly.
  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
    if (code !== 0) {
      dialog.showErrorBox('Backend Stopped', `The backend service stopped unexpectedly with code ${code}.`);
    }
  });
}

/**
 * Creates and configures the main application window.
 */
function createWindow() {
  // Create a new browser window with specified dimensions and web preferences.
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // The 'preload' script runs in a privileged environment and acts as a bridge
      // between the Node.js environment (main process) and the renderer process (web page).
      preload: path.join(__dirname, 'preload.js'),
      // 'contextIsolation' is a security feature that ensures the preload script and the
      // renderer's JavaScript run in separate contexts.
      contextIsolation: true,
      // 'nodeIntegration' is disabled for security, preventing the renderer from
      // directly accessing Node.js APIs.
      nodeIntegration: false,
    },
  });

  // --- Load Application Content ---
  if (isDev) {
    // In development, we load the content from the Next.js development server.
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools(); // Automatically open Chrome DevTools.
  } else {
    // In production, we load the content served by our Python backend.
    const startUrl = `http://localhost:${BACKEND_PORT}`;
    win.loadURL(startUrl);
  }

  // --- Inter-Process Communication (IPC) Handlers ---
  // These handlers allow the renderer process to securely request actions from the main process.

  // Handle requests from the renderer to open a directory selection dialog.
  ipcMain.handle('select-dir', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    // Return the selected path or null if the dialog was canceled.
    return result.canceled ? null : result.filePaths[0];
  });

  // Handle requests to open the system's file explorer at a given path.
  ipcMain.handle('open-path-in-explorer', (event, filePath) => {
    // Use the appropriate method to open the file explorer.
    // 'shell.showItemInFolder' is the preferred Electron way.
    require('electron').shell.showItemInFolder(filePath);
  });
}

// --- Electron App Lifecycle Events ---

// This method is called when Electron has finished initialization.
app.whenReady().then(() => {
  startBackend(); // Start our backend service first.
  createWindow(); // Then create the application window.

  // Handle macOS 'activate' event (e.g., clicking the app's dock icon).
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit the app when all windows are closed (except on macOS).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// This event is emitted when the application is about to close.
app.on('quit', () => {
  // It's crucial to terminate the backend process when the app quits.
  if (backendProcess) {
    console.log('Terminating backend process...');
    backendProcess.kill();
  }
});
