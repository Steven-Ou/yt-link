// frontend/main.js

// --- Import necessary modules from Electron and Node.js ---
const { app, BrowserWindow, ipcMain } = require('electron'); // Core Electron modules for app lifecycle, window creation, and inter-process communication.
const path = require('path'); // Node.js module for handling and transforming file paths.
const { spawn } = require('child_process'); // Node.js module for creating and managing child processes.
const { autoUpdater } = require('electron-updater'); // Handles automatic application updates.
const fetch = require('node-fetch'); // A module for making network requests, similar to the browser's fetch API.

// --- Global variables ---
let mainWindow; // Will hold the main window object.
let backendProcess; // Will hold the reference to our Python backend child process.

/**
 * Creates and configures the main application window.
 */
function createWindow() {
  // Create a new browser window with specified dimensions and web preferences.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // The 'preload' script runs before the web page is loaded into the renderer.
      // It has access to Node.js APIs and is used to expose functionality to the renderer process securely.
      preload: path.join(__dirname, 'preload.js'),
      // contextIsolation is a security feature that ensures 'preload' scripts and the renderer's JavaScript run in separate contexts.
      contextIsolation: true,
      // nodeIntegration is disabled for security, preventing the renderer process from having direct access to Node.js APIs.
      nodeIntegration: false,
    },
  });

  // Load the appropriate content based on the environment (development or production).
  if (process.env.NODE_ENV === 'development') {
    // In development, load the Next.js development server URL.
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // In production, load the static HTML file built by Next.js.
    mainWindow.loadFile(path.join(__dirname, 'out/index.html'));
  }
}

/**
 * Starts the Python backend service as a child process.
 */
function startBackend() {
  const isDev = process.env.NODE_ENV === 'development';
  let backendExecutablePath;

  if (isDev) {
    // In development mode, run the Python script directly using the 'python' command.
    backendExecutablePath = 'python';
    const scriptPath = path.join(__dirname, '..', 'service', 'app.py');
    backendProcess = spawn(backendExecutablePath, [scriptPath]);
  } else {
    // In production mode, run the packaged executable.
    // The executable name differs between Windows and other OSes (macOS, Linux).
    const backendName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
    // The executable is located in the 'resources/backend' directory of the packaged app.
    backendExecutablePath = path.join(process.resourcesPath, 'backend', backendName);
    backendProcess = spawn(backendExecutablePath);
  }

  console.log(`Starting backend executable: ${backendExecutablePath}`);

  // --- START OF DEBUGGING CODE ---
  // These listeners help debug the Python backend by logging its output to the Electron console.
  
  // Listen for standard output from the backend process.
  backendProcess.stdout.on('data', (data) => {
    console.log(`Backend stdout: ${data}`);
  });

  // Listen for any errors from the backend process.
  backendProcess.stderr.on('data', (data) => {
    console.error(`Backend stderr: ${data}`);
  });

  // Log when the backend process closes and show its exit code.
  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
  });
  // --- END OF DEBUGGING CODE ---
}

// --- Electron App Lifecycle Events ---

// This event is fired when Electron has finished initialization.
app.on('ready', () => {
  startBackend(); // Start the Python service.
  createWindow(); // Create the main application window.

  // Automatically check for application updates and notify the user if one is available.
  autoUpdater.checkForUpdatesAndNotify();

  // When the content in the main window has finished loading...
  mainWindow.webContents.on('did-finish-load', () => {
    // ...send the backend server's URL to the renderer process.
    mainWindow.webContents.send('backend-url', 'http://127.0.0.1:5001');
  });
});

// This event is fired when all windows have been closed.
app.on('window-all-closed', () => {
  // On Windows and Linux, quitting the app is standard behavior. On macOS, apps usually stay active.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// This event is fired just before the application starts closing its windows.
app.on('before-quit', () => {
  // If the backend process is running, terminate it to ensure a clean exit.
  if (backendProcess) {
    console.log('Killing backend process...');
    backendProcess.kill();
  }
});

// This event is fired on macOS when the dock icon is clicked and there are no other windows open.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(); // Re-create the main window.
  }
});

// --- Inter-Process Communication (IPC) ---

/**
 * A generic and secure handler to forward API requests from the UI to the Python backend.
 * @param {string} endpoint - The API endpoint on the Python server (e.g., 'start-single-mp3-job').
 * @param {object} body - The JSON payload to send.
 * @returns {Promise<object>} - The JSON response from the Python server or a structured error object.
 */
async function forwardToPython(endpoint, body) {
    const url = `http://127.0.0.1:5001/${endpoint}`;
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(`Python service error: ${await response.text()}`);
        return await response.json();
    } catch (error) {
        console.error(`[Main->Python] CRITICAL ERROR:`, error);
        return { error: 'Failed to communicate with the backend service.' };
    }
}

// Handlers for the various job types. These listen for messages from the frontend,
// call the generic forwarder function, and send the results back.
ipcMain.handle('start-single-mp3-job', (_, args) => forwardToPython('start-single-mp3-job', args));
ipcMain.handle('start-playlist-zip-job', (_, args) => forwardToPython('start-playlist-zip-job', args));
ipcMain.handle('start-combine-playlist-mp3-job', (_, args) => forwardToPython('start-combine-playlist-mp3-job', args));

// This handler fetches the status of a specific job from the Python backend.
ipcMain.handle('get-job-status', async (_, jobId) => {
    try {
        const response = await fetch(`http://127.0.0.1:5001/job-status/${jobId}`);
        if (!response.ok) throw new Error(`Failed to get job status: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error(`[Main->Python] Status Check Error:`, error);
        return { error: 'Failed to get job status.' };
    }
});

// This handler was in your more advanced script. I'm including it here because it's very useful.
// It opens a native "Save As..." dialog for the user.
ipcMain.handle('save-file', async (event, jobInfo) => {
    if (!jobInfo || !jobInfo.filepath || !jobInfo.filename) {
        return { error: 'Invalid job information provided.' };
    }
    const { filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: jobInfo.filename });
    if (!filePath) {
        return { success: false, reason: 'User cancelled save.' };
    }
    try {
        fs.copyFileSync(jobInfo.filepath, filePath);
        return { success: true, path: filePath };
    } catch (error) {
        console.error('Failed to save file:', error);
        return { success: false, error: 'Failed to save file.' };
    }
});

// Sets up a basic IPC handler that the renderer process can invoke to get the backend URL.
ipcMain.handle('get-backend-url', async () => {
  return 'http://127.0.0.1:5001';
});
