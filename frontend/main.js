// --- ELECTRON AND NODE.JS IMPORTS ---
// Import necessary modules from the Electron framework and Node.js.
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // Core Electron modules
const path = require('path'); // Node.js module for handling file paths
const { spawn } = require('child_process'); // Node.js module for creating child processes (to run Python)
const { autoUpdater } = require('electron-updater'); // Handles automatic updates
// const reloader = require('electron-reloader'); // Temporarily disabled to prevent lag from error loops.
const fetch = require('node-fetch'); // Used to make HTTP requests from the main process to the Python backend

// --- DEVELOPMENT SETTINGS ---
// The reloader is disabled to prevent the app from lagging due to repeated errors in the UI.
// try {
//     reloader(module); // Temporarily disabled
// } catch (_) {
//     // Fails in production, which is expected. We can safely ignore the error.
// }

// --- GLOBAL VARIABLES ---
let mainWindow; // Holds the main application window object.
let pythonProcess = null; // Holds the spawned Python backend process object.

// --- CONSTANTS ---
// Define constants for the Python backend command and script path for clarity and easy maintenance.
const PYTHON_COMMAND = 'python3'; 
const SCRIPT_PATH = path.join(__dirname, '..', 'service', 'app.py');

// --- PYTHON BACKEND MANAGEMENT ---
/**
 * Starts the Python Flask server as a background child process.
 * This function also sets up listeners to capture the Python process's
 * standard output and standard error for debugging purposes.
 */
function startPythonBackend() {
    // Determine the correct command to run Python based on the operating system.
    const pythonCommand = process.platform === 'win32' ? 'python' : PYTHON_COMMAND;
    // Get the absolute path to the Python script.
    const scriptPath = path.resolve(SCRIPT_PATH);
    
    console.log(`Starting Python backend with command: ${pythonCommand} ${scriptPath}`);

    // Spawn the python process. This runs the command in the background.
    pythonProcess = spawn(pythonCommand, [scriptPath]);

    // Listener for standard output from the Python script (e.g., print statements).
    pythonProcess.stdout.on('data', (data) => {
        console.log(`Python Backend: ${data}`);
    });

    // Listener for standard error from the Python script (e.g., error messages).
    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python Backend Error: ${data}`);
    });

    // Listener for when the Python process closes.
    pythonProcess.on('close', (code) => {
        console.log(`Python Backend exited with code ${code}`);
    });
}

// --- ELECTRON WINDOW CREATION ---
/**
 * Creates and configures the main application window (BrowserWindow).
 * This function also sets up the auto-updater and handles loading content
 * for both development and production environments.
 */
function createWindow() {
    // Create a new browser window with specified dimensions and web preferences.
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            // The preload script acts as a bridge between the Electron main process and the renderer process (the UI).
            preload: path.join(__dirname, 'preload.js'),
            // contextIsolation is a security feature that keeps the preload script and renderer process separate.
            contextIsolation: true,
            // nodeIntegration should be false for security reasons. All Node.js logic should be in the main process or preload script.
            nodeIntegration: false,
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.png'), // Application icon
    });
    
    // --- AUTO-UPDATER CONFIGURATION ---
    // Configure the auto-updater to check for releases on your GitHub repository.
    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'steven-ou',
        repo: 'yt-link',
    });
    
    // Tell the auto-updater to check for new updates and notify the user if one is available.
    autoUpdater.checkForUpdatesAndNotify();
    
    // --- AUTO-UPDATER EVENT LISTENERS ---
    // These listeners send messages to the UI (renderer process) when an update event occurs.
    autoUpdater.on('update-available', () => {
        mainWindow.webContents.send('update-available');
    });
    
    autoUpdater.on('update-downloaded', () => {
        mainWindow.webContents.send('update-downloaded');
    });
    
    // This listener waits for a message from the UI to restart the app and install the update.
    ipcMain.on('restart-app', () => {
        autoUpdater.quitAndInstall();
    });

    // --- LOADING UI CONTENT ---
    // Check if the application is running in development mode.
    const isDev = process.env.NODE_ENV !== 'production';

    if (isDev) {
        // In development, load the Next.js development server URL.
        // ** FIX: Changed port back to the default of 3000. **
        mainWindow.loadURL('http://localhost:3000');
        // Automatically open the Chrome DevTools for debugging.
        mainWindow.webContents.openDevTools();
    } else {
        // In production, load the static HTML file generated by 'next build'.
        const indexPath = path.join(__dirname, 'out', 'index.html');
        mainWindow.loadFile(indexPath);
    }

    // Event listener for when the window is closed.
    mainWindow.on('closed', function () {
        // Dereference the window object to allow for garbage collection.
        mainWindow = null;
    });
}

// --- IPC COMMUNICATION BRIDGE ---
/**
 * Handles all API requests from the UI (via IPC) to the Python backend (via HTTP).
 * This function acts as a secure bridge, preventing the UI from making direct network requests.
 * @param {string} endpoint - The API endpoint to call on the Python server (e.g., 'start-single-mp3-job').
 * @param {object} body - The JSON body to send with the request.
 * @returns {Promise<object>} - A promise that resolves with the JSON response from the Python server.
 */
async function handleJobRequest(endpoint, body) {
    const url = `http://127.0.0.1:8080/${endpoint}`;
    console.log(`[main.js] Attempting to POST to: ${url}`);
    console.log(`[main.js] With body: ${JSON.stringify(body)}`);

    try {
        // Make the HTTP POST request to the Python Flask server.
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        console.log(`[main.js] Received response status: ${response.status}`);

        // Check if the request was successful.
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[main.js] HTTP error! Status: ${response.status}, Body: ${errorText}`);
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Parse the JSON response and return it.
        const data = await response.json();
        console.log('[main.js] Successfully got JSON response from Python:', data);
        return data;
    } catch (error) {
        // Catch any network or other errors during the fetch call.
        console.error('[main.js] CRITICAL: Failed to communicate with Python backend. Full error:');
        console.error(error);
        // Return a structured error object to the renderer process.
        return { error: 'Failed to get Job ID from server.' };
    }
}

// --- ELECTRON APP LIFECYCLE EVENTS ---

// This method will be called when Electron has finished initialization and is ready to create browser windows.
app.on('ready', () => {
    startPythonBackend(); // Start the backend server first.
    createWindow();       // Then create the application window.
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', function () {
    // On macOS, it's common for applications to stay active until the user explicitly quits.
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Before the application quits, ensure the Python backend process is terminated.
app.on('before-quit', () => {
    if (pythonProcess) {
        console.log('Killing Python backend process...');
        pythonProcess.kill();
    }
});

// On macOS, re-create a window in the app when the dock icon is clicked and there are no other windows open.
app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});

// --- IPC HANDLERS ---
// These handlers listen for messages from the renderer process (via the preload script).

// IPC handler for starting a new download job.
ipcMain.handle('start-job', async (event, endpoint, body) => {
    console.log(`[main.js] Received 'start-job' IPC call for endpoint: ${endpoint}`);
    // Use the bridge function to securely forward the request to the Python backend.
    return await handleJobRequest(endpoint, body);
});

// IPC handler for checking the status of an ongoing job.
ipcMain.handle('check-status', async (event, jobId) => {
    try {
        const response = await fetch(`http://127.0.0.1:8080/job-status/${jobId}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`Error checking status for job ${jobId}:`, error);
        return { error: 'Failed to get job status.' };
    }
});

// IPC handler for showing a native "open directory" dialog.
ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    // Return the selected directory path to the renderer process.
    return result.filePaths[0];
});
