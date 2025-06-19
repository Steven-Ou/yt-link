// --- ELECTRON AND NODE.JS IMPORTS ---
// This section imports all the necessary modules for the application to run.
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // Core Electron modules for app lifecycle, window creation, inter-process communication, and native dialogs.
const path = require('path'); // Node.js utility for handling and transforming file paths in a cross-platform way.
const url = require('url'); // Node.js utility for URL parsing, essential for creating `file://` URLs for local content.
const fs = require('fs'); // Node.js File System module, used here for file operations like checking for and copying files.
const { spawn } = require('child_process'); // Node.js module to create and manage independent child processes, used here to run the Python backend.
const { autoUpdater } = require('electron-updater'); // The primary module for handling automatic application updates from a release server like GitHub.
const fetch = require('node-fetch'); // A light-weight module that brings the browser's `fetch` API to Node.js, for making HTTP requests from the main process.

// --- GLOBAL VARIABLES ---
// These are declared in the global scope to be accessible throughout the file.
let mainWindow; // This will hold the main application window object. It's kept global to prevent garbage collection from closing the window prematurely.
let pythonProcess = null; // This will hold the spawned Python backend process object, allowing us to manage it (e.g., terminate it when the app quits).

// --- PYTHON BACKEND MANAGEMENT ---
/**
 * Starts the self-contained Python backend executable created by PyInstaller.
 * This function is the bridge between the Electron app and the Python logic.
 */
function startPythonBackend() {
    // In a packaged Electron app, extra files (like our backend executable) are stored in a 'resources' directory.
    // `process.resourcesPath` provides the reliable, cross-platform path to this directory.
    const backendPath = path.join(process.resourcesPath, 'backend');
    // Determine the correct executable name based on the user's operating system.
    const executableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
    // Construct the full path to the backend executable.
    const backendExecutable = path.join(backendPath, executableName);

    console.log(`[Backend Start] Attempting to run executable at: ${backendExecutable}`);
    
    // Before trying to run the executable, we must verify it exists and is runnable.
    // `fs.accessSync` will throw an error if the file doesn't exist or doesn't have execute permissions.
    try {
        fs.accessSync(backendExecutable, fs.constants.X_OK); // X_OK checks for execute permission.
    } catch (err) {
        // If the file is missing, show an informative error to the user. This is critical for debugging deployment issues.
        console.error('[Backend Start] CRITICAL: Backend executable not found or not executable.', err);
        dialog.showErrorBox('Backend Error', `The backend executable could not be found at ${backendExecutable}. Please ensure it was packaged correctly.`);
        return; // Stop the function if the backend can't be found.
    }

    // Spawn the executable directly. No need for 'python3' anymore since all dependencies are bundled.
    // This runs the backend in a completely separate process from the main Electron app.
    pythonProcess = spawn(backendExecutable);

    // It's crucial to listen for events on the new process to understand its state.
    // The 'error' event fires if the process fails to start for reasons other than not being found (e.g., corrupt file).
    pythonProcess.on('error', (err) => {
        console.error('[Backend Start] CRITICAL: Failed to start backend executable.', err);
        dialog.showErrorBox('Backend Service Error', 'The backend service failed to start. Please check the logs for more details.');
    });

    // Listen to the backend's standard output stream to see its log messages (from `print` statements).
    pythonProcess.stdout.on('data', (data) => console.log(`[Backend]: ${data.toString()}`));
    // Listen to the backend's standard error stream to catch any Python errors or tracebacks.
    pythonProcess.stderr.on('data', (data) => console.error(`[Backend Error]: ${data.toString()}`));
    // The 'close' event fires when the process terminates.
    pythonProcess.on('close', (code) => console.log(`[Backend] Exited with code ${code}`));
}


// --- ELECTRON WINDOW CREATION ---
/**
 * Creates and configures the main application window (BrowserWindow).
 */
function createWindow() {
    // Use Electron's built-in `app.isPackaged` property. This is the modern, reliable way to check the environment.
    // It's `false` when running locally (`npm run electron:dev`) and `true` when the app is packaged.
    const isDev = !app.isPackaged;
    // Create a new browser window instance.
    mainWindow = new BrowserWindow({ 
        width: 1200, 
        height: 800, 
        webPreferences: { 
            // The preload script is the secure bridge between this main process (Node.js) and the renderer process (the UI).
            preload: path.join(__dirname, 'preload.js'),
            // `contextIsolation` is a key security feature. It prevents the renderer from accessing Node.js APIs directly.
            contextIsolation: true, 
            // `nodeIntegration` must be false for security.
            nodeIntegration: false 
        }
    });

    // Determine what content to load into the window based on the environment.
    const startUrl = isDev 
        ? 'http://localhost:3000' // In development, load the Next.js dev server for hot-reloading.
        : `file://${path.join(__dirname, 'out/index.html')}`; // In production, load the static HTML file generated by `next build`.

    mainWindow.loadURL(startUrl);

    // Perform environment-specific actions.
    if (isDev) {
        // Automatically open the Chrome DevTools for easy debugging during development.
        mainWindow.webContents.openDevTools();
    } else {
        // Only configure and check for auto-updates in the packaged production app.
        autoUpdater.on('update-available', () => mainWindow.webContents.send('update-status', 'Update available.'));
        autoUpdater.on('update-downloaded', () => mainWindow.webContents.send('update-status', 'Update downloaded. Click restart to install.'));
        mainWindow.once('ready-to-show', () => autoUpdater.checkForUpdatesAndNotify());
    }
    // Event listener for when the window is closed.
    mainWindow.on('closed', () => { 
        // Dereference the window object for memory management.
        mainWindow = null; 
    });
}

// --- IPC AND APP LIFECYCLE ---

/**
 * A generic and secure handler to forward API requests from the UI to the Python backend.
 * @param {string} endpoint - The API endpoint on the Python server (e.g., 'start-single-mp3-job').
 * @param {object} body - The JSON payload to send.
 * @returns {Promise<object>} - The JSON response from the Python server or a structured error object.
 */
async function forwardToPython(endpoint, body) {
    const url = `http://127.0.0.1:8080/${endpoint}`;
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(`Python service error: ${await response.text()}`);
        return await response.json();
    } catch (error) {
        // This catch block is crucial for handling network errors (e.g., if the backend isn't running).
        console.error(`[Main->Python] CRITICAL ERROR:`, error);
        return { error: 'Failed to communicate with the backend service.' };
    }
}

// --- App Lifecycle Handlers ---

// This method is called when Electron has finished initialization. It's the main entry point.
app.on('ready', () => {
    // Only start the backend service when the app is packaged and running in production.
    // In development, we assume you're running the Python script manually for easier debugging.
    if (app.isPackaged) {
      startPythonBackend();
    }
    createWindow(); // Create the main application window.
});

// This event fires when all windows have been closed.
app.on('window-all-closed', () => {
    // On macOS, it's standard for apps to stay active until explicitly quit. On other platforms (Windows, Linux), we quit.
    if (process.platform !== 'darwin') app.quit();
});

// This event fires just before the application begins to close its windows.
app.on('before-quit', () => {
    // It's crucial to terminate the child process to prevent it from becoming a "zombie" process after the main app closes.
    if (pythonProcess) {
        pythonProcess.kill();
    }
});

// On macOS, this event fires when the dock icon is clicked and there are no other windows open.
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- IPC Handlers for Frontend API ---
// These handlers define the secure API that the frontend can use to interact with the main process.
// They act as a safe pass-through to the `forwardToPython` function.
ipcMain.handle('start-single-mp3-job', (_, args) => forwardToPython('start-single-mp3-job', args));
ipcMain.handle('start-playlist-zip-job', (_, args) => forwardToPython('start-playlist-zip-job', args));
ipcMain.handle('start-combine-playlist-mp3-job', (_, args) => forwardToPython('start-combine-playlist-mp3-job', args));

// This handler fetches the status of a specific job from the Python backend.
ipcMain.handle('get-job-status', async (_, jobId) => {
    try {
        const response = await fetch(`http://127.0.0.1:8080/job-status/${jobId}`);
        return await response.json();
    } catch (error) {
        return { error: 'Failed to get job status.' };
    }
});

// This handler manages the file saving process using a native dialog.
ipcMain.handle('save-file', async (event, jobInfo) => {
    if (!jobInfo || !jobInfo.filepath || !jobInfo.filename) return { error: 'Invalid job information provided.' };
    // Shows a native "Save As..." dialog to the user.
    const { filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: jobInfo.filename });
    // If the user cancels the save dialog, `filePath` will be empty.
    if (!filePath) return { success: false, reason: 'User cancelled save.' };
    // Copies the file from the temporary backend location to the user's chosen destination.
    try {
        fs.copyFileSync(jobInfo.filepath, filePath);
        return { success: true, path: filePath };
    } catch (error) {
        console.error('Failed to save file:', error);
        return { success: false, error: 'Failed to save file.' };
    }
});

// This handler listens for the 'restart-and-install' message from the UI to trigger the update process.
ipcMain.on('restart-and-install', () => { autoUpdater.quitAndInstall(); });
