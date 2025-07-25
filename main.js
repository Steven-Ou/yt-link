/**
 * @file This is the main process file for the Electron application.
 * It's responsible for:
 * - Creating and managing the application window (BrowserWindow).
 * - Spawning and managing a Python backend service as a child process.
 * - Handling communication between the frontend (renderer process) and the Python backend.
 * - Managing the application's lifecycle.
 */

// --- MODULE IMPORTS ---
// Core Electron modules for application and window management.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron'); 
// Node.js module for working with file and directory paths.
const path = require('path');
// Node.js module to create and manage child processes. Used here to run the Python backend.
const { spawn } = require('child_process');
// Utility to find an open network port. Essential for starting the backend without conflicts.
const portfinder = require('portfinder');
// A lightweight module that brings the Fetch API to Node.js. Used for backend communication.
const fetch = require('node-fetch');
// Node.js module for interacting with the file system. Used for saving downloaded files.
const fs = require('fs');

// --- GLOBAL VARIABLES ---
// Holds the reference to the spawned Python child process.
let pythonProcess = null;
// Holds the reference to the main application window.
let mainWindow = null;
// Stores the port number that the Python backend will run on.
let pyPort = null;
// A flag to track if the Python backend has successfully started and is ready to accept requests.
let isBackendReady = false;

/**
 * A centralized logging function.
 * It logs messages to the main process console and also sends them to the 
 * renderer process (frontend) via IPC to be displayed in the UI's log console.
 * @param {string} message - The message to log.
 */
function sendLog(message) {
    console.log(message);
    // Ensure the main window and its webContents are valid before sending a message.
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('backend-log', message);
    }
}

/**
 * Loads the frontend content into the main application window.
 * It handles loading from a local development server (localhost:3000)
 * or from the static build files in a packaged application.
 * Includes a retry mechanism in case the initial load fails (e.g., dev server is slow to start).
 */
function loadMainWindow() {
    // Determine the correct URL based on whether the app is packaged for production or running in development.
    const urlToLoad = !app.isPackaged
        ? 'http://localhost:3000' // Development URL (e.g., from a React/Next.js dev server)
        : `file://${path.join(__dirname, 'frontend/out/index.html')}`; // Production URL (static file)
    
    sendLog(`[Electron] Attempting to load URL: ${urlToLoad}`);
    
    // Attempt to load the URL.
    mainWindow.loadURL(urlToLoad).catch(err => {
        sendLog(`[Electron] First load attempt failed: ${err.message}. Retrying in 2 seconds...`);
        // If the first attempt fails, wait 2 seconds and try again.
        setTimeout(() => {
            mainWindow.loadURL(urlToLoad).catch(err2 => {
                // If the second attempt also fails, show a fatal error dialog to the user.
                const errorString = JSON.stringify(err2, Object.getOwnPropertyNames(err2));
                sendLog(`[Electron] FATAL: Failed to load URL on second attempt: ${urlToLoad}. Error: ${errorString}`);
                dialog.showErrorBox('Fatal Load Error', `The application window failed to load twice. Please restart the app or check logs.\n${errorString}`);
            });
        }, 2000);
    });
}

/**
 * Creates the main application window and initializes the Python backend.
 */
function createWindow() {
    // Create a new browser window with specified dimensions and web preferences.
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            // The preload script is a bridge between the renderer process and the main process.
            preload: path.join(__dirname, 'preload.js'),
            // Enforces a separation between the renderer's context and Node.js/Electron APIs for security.
            contextIsolation: true,
            // Disables Node.js integration in the renderer for security.
            nodeIntegration: false,
        },
        title: "YT Link"
    });
    
    // Load the frontend URL into the newly created window immediately.
    // This will show the UI to the user while the backend starts in the background.
    loadMainWindow();

    // Find an available port to run the backend service on, starting the search from 5001.
    sendLog('[Electron] Finding a free port for the backend...');
    portfinder.getPortPromise({ port: 5001 })
        .then(freePort => {
            // Once a free port is found, store it and start the Python backend.
            sendLog(`[Electron] Found free port: ${freePort}. Starting Python backend.`);
            pyPort = freePort;
            startPythonBackend(pyPort);
        })
        .catch(err => {
            // If no free port can be found, show an error and quit the application.
            const errorMessage = `Could not find a free port for the backend service.\n\nError: ${err.message}`;
            sendLog(`[Electron] Portfinder error: ${errorMessage}`);
            dialog.showErrorBox('Startup Error', errorMessage);
            app.quit();
        });

    // If the application is not packaged (i.e., in development mode), open the DevTools.
    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools();
    }

    // Event listener for when the window is closed.
    mainWindow.on('closed', () => {
        // Dereference the window object to allow for garbage collection.
        mainWindow = null;
    });
}

/**
 * Spawns the Python backend as a child process.
 * It handles the different paths and commands required for development vs. a packaged application.
 * @param {number} port - The port number for the Python backend to listen on.
 */
function startPythonBackend(port) {
    const isDev = !app.isPackaged;
    
    // Determine the correct executable name based on the operating system.
    const backendName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
    const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

    // Determine the command to execute and the arguments to pass.
    // In development, we run the Python script directly.
    // In production, we run the packaged executable.
    const command = isDev 
        ? (process.platform === 'win32' ? 'python' : 'python3') 
        : path.join(process.resourcesPath, 'backend', backendName);

    const args = isDev 
        ? ['-u', path.join(__dirname, 'service', 'app.py'), port.toString()] // Use -u for unbuffered output in dev
        : [port.toString(), path.join(process.resourcesPath, 'bin', ffmpegName)];
    
    sendLog(`[Electron] Starting backend with command: "${command}"`);
    sendLog(`[Electron] Using arguments: [${args.join(', ')}]`);
    
    // Spawn the child process.
    pythonProcess = spawn(command, args);

    // --- PROCESS EVENT LISTENERS ---

    // Handle errors during the spawning of the process itself.
    pythonProcess.on('error', (err) => {
        sendLog(`[Electron] FAILED TO START PYTHON PROCESS: ${err}`);
        dialog.showErrorBox('Backend Error', `Failed to start the backend service:\n${err}`);
    });

    // Listen for data from the backend's standard output.
    pythonProcess.stdout.on('data', (data) => {
        const log = data.toString().trim();
        sendLog(`[Python STDOUT]: ${log}`);
        // Look for a specific message from the backend to confirm it's ready.
        if (log.includes(`Flask-Backend-Ready:${port}`)) {
            isBackendReady = true;
            sendLog('[Electron] Backend is ready.');
        }
    });
    
    // Listen for data from the backend's standard error.
    pythonProcess.stderr.on('data', (data) => {
        sendLog(`[Python STDERR]: ${data.toString().trim()}`);
    });
    
    // Handle the process exiting.
    pythonProcess.on('close', (code) => {
        isBackendReady = false;
        sendLog(`[Electron] Python process exited with code ${code}`);
        // If the process exited with an error code before it was ready, show an error.
        if (code !== 0 && !isBackendReady) {
            dialog.showErrorBox('Backend Error', `The backend service failed to start or closed unexpectedly with code: ${code}. Please check the logs.`);
        }
    });
}

// --- ELECTRON APP LIFECYCLE EVENTS ---

// This method will be called when Electron has finished initialization.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// On macOS, re-create a window when the dock icon is clicked and there are no other windows open.
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Before the application quits, ensure the Python backend process is terminated.
app.on('quit', () => {
    if (pythonProcess) {
        pythonProcess.kill();
    }
});

// --- IPC HANDLERS ---
// These functions handle asynchronous messages from the renderer process (frontend).

/**
 * IPC Handler: 'start-job'
 * Receives a job request from the frontend and forwards it to the Python backend.
 */
ipcMain.handle('start-job', async (event, { jobType, url, cookies }) => {
    if (!isBackendReady) {
        return { error: 'Backend is not ready. Please wait a moment or restart the application.' };
    }
    
    const payload = { jobType, url, cookies };

    try {
        sendLog(`[Electron] Sending job to Python with payload: ${JSON.stringify(payload)}`);
        // Use fetch to send a POST request to the Python backend's /start-job endpoint.
        const response = await fetch(`http://127.0.0.1:${pyPort}/start-job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Backend responded with status: ${response.status} ${errorText}`);
        }
        return await response.json(); // Return the backend's response to the frontend.
    } catch (error) {
        sendLog(`[Electron] ERROR: Failed to communicate with backend: ${error.message}`);
        return { error: `Failed to communicate with backend: ${error.message}` };
    }
});

/**
 * IPC Handler: 'get-job-status'
 * Polls the Python backend for the status of a specific job.
 */
ipcMain.handle('get-job-status', async (event, jobId) => {
    if (!isBackendReady) return { status: 'failed', message: 'Backend is not running.' };
    try {
        const response = await fetch(`http://127.0.0.1:${pyPort}/job-status?jobId=${jobId}`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Backend responded with status: ${response.status} ${errorText}`);
        }
        return await response.json(); // Return the status to the frontend.
    } catch (error) {
        return { error: error.message };
    }
});

/**
 * IPC Handler: 'download-file'
 * Handles the final step of downloading a completed file from the backend.
 */
ipcMain.handle('download-file', async (event, jobId) => {
    if (!isBackendReady) return { error: 'Backend is not running.' };
    try {
        // First, get the job status to find the correct filename.
        const jobStatusUrl = `http://127.0.0.1:${pyPort}/job-status?jobId=${jobId}`;
        const statusResponse = await fetch(jobStatusUrl);
        const job = await statusResponse.json();

        if (job.status !== 'completed' || !job.file_name) {
            return { error: 'File is not ready for download.' };
        }
        
        // Construct a safe file path in the user's default 'downloads' directory.
        const downloadsPath = app.getPath('downloads');
        const safeFileName = job.file_name.replace(/[\\/]/g, '_'); // Sanitize filename.
        const filePath = path.join(downloadsPath, safeFileName);
        
        // Fetch the file content from the backend's /download endpoint.
        const downloadUrl = `http://127.0.0.1:${pyPort}/download/${jobId}`;
        const downloadResponse = await fetch(downloadUrl);

        if (!downloadResponse.ok) throw new Error(`Backend download error: ${await downloadResponse.text()}`);

        // Stream the file data directly to a file on disk to handle large files efficiently.
        const fileStream = fs.createWriteStream(filePath);
        await new Promise((resolve, reject) => {
            downloadResponse.body.pipe(fileStream);
            downloadResponse.body.on("error", reject);
            fileStream.on("finish", resolve);
        });

        return { success: true, path: filePath }; // Inform the frontend of success.
    } catch(error) {
        sendLog(`[Electron] Download Error: ${error.message}`);
        dialog.showErrorBox('Download Error', `Could not download the file: ${error.message}`);
        return { error: error.message };
    }
});

/**
 * IPC Handler: 'open-folder'
 * Opens the folder containing the downloaded file in the native file explorer.
 */
ipcMain.handle('open-folder', (event, folderPath) => {
    if (folderPath && fs.existsSync(folderPath)) {
        // Use Electron's shell module to perform this OS-level action.
        shell.showItemInFolder(folderPath);
    } else {
        sendLog(`[Electron] ERROR: Attempted to open non-existent path: ${folderPath}`);
        dialog.showErrorBox('File Not Found', `The path does not exist: ${folderPath}`);
    }
});
