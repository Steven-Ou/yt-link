// Import necessary modules from the Electron library.
// 'app' controls the application's event lifecycle.
// 'BrowserWindow' creates and manages application windows.
// 'ipcMain' handles asynchronous and synchronous messages sent from the renderer process (the UI).
const { app, BrowserWindow, ipcMain } = require('electron');

// Import the 'path' module, a core Node.js library for working with file and directory paths.
const path = require('path');

// Import the 'spawn' function from the 'child_process' module to run external processes, like our Python script.
const { spawn } = require('child_process');

// Import 'node-fetch' to make HTTP requests from the main process to the Python backend.
const fetch = require('node-fetch');

// Check if the application is running in a development environment.
// 'NODE_ENV' is 'production' when the app is packaged, otherwise it's 'undefined' or 'development'.
const isDev = process.env.NODE_ENV !== 'production';

// --- HOT RELOADING SECTION ---
// This block sets up automatic reloading of the app during development.
if (isDev) {
    // A try-catch block is used to prevent errors if 'electron-reloader' is not installed.
    try {
        // Require the 'electron-reloader' module and pass it the current module object.
        // This will watch for file changes and reload the Electron app automatically.
        require('electron-reloader')(module);
    } catch (_) {
        // If 'electron-reloader' is not found (e.g., in production), this block catches the error and does nothing, preventing a crash.
    }
}

// Declare a variable to hold a reference to the Python child process.
// This allows us to manage it, specifically to kill it when the app closes.
let pythonProcess = null;

// This function starts the Python backend service.
function startPythonBackend() {
    // Construct the full, cross-platform path to the Python script in the 'service' directory.
    // In production, the 'service' folder is at the root of the app package.
    const scriptPath = isDev 
        ? path.join(__dirname, '..', 'service', 'app.py') 
        : path.join(process.resourcesPath, 'app.asar.unpacked', 'service', 'app.py');

    // Determine the python command based on the OS.
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    
    // Use 'spawn' to execute the Python script as a separate process.
    pythonProcess = spawn(pythonCommand, [scriptPath]);

    // Listen for data coming from the Python process's standard output (e.g., print statements).
    pythonProcess.stdout.on('data', (data) => {
        // Log the output from the Python backend to the main process console for debugging.
        console.log(`Python Backend: ${data}`);
    });

    // Listen for data coming from the Python process's standard error.
    pythonProcess.stderr.on('data', (data) => {
        // Log any errors from the Python backend for debugging.
        console.error(`Python Backend Error: ${data}`);
    });

    // Listen for the 'close' event, which is emitted when the Python process exits.
    pythonProcess.on('close', (code) => {
        // Log the exit code of the Python process.
        console.log(`Python Backend exited with code ${code}`);
    });
}

// This function creates the main application window.
function createWindow() {
    // Create a new browser window instance with specified dimensions and preferences.
    const mainWindow = new BrowserWindow({
        width: 1100, // Set the initial width of the window.
        height: 750, // Set the initial height of the window.
        webPreferences: {
            // Specify the 'preload' script. This script runs in a privileged environment before the web page is loaded.
            preload: path.join(__dirname, 'preload.js'),
            // 'contextIsolation' is a security feature that ensures the preload script and the renderer's scripts run in different contexts.
            contextIsolation: true,
            // 'nodeIntegration' is disabled for security, preventing the renderer process from having direct access to Node.js APIs.
            nodeIntegration: false,
        },
    });

    // Check if the app is in development mode.
    if (isDev) {
        // In development, load the URL provided by the Next.js development server.
        mainWindow.loadURL('http://localhost:3000');
        // Automatically open the Chrome DevTools for debugging.
        mainWindow.webContents.openDevTools();
    } else {
        // In production, load the static 'index.html' file from the 'out' directory.
        // This path is now corrected for the packaged application structure.
        mainWindow.loadFile(path.join(__dirname, 'out', 'index.html'));
    }
}

// --- IPC (Inter-Process Communication) Handlers ---
// This single, reusable async function handles all API requests from the UI to the Python backend.
async function handleJobRequest(endpoint, body) {
    // Use a try-catch block to handle any errors during the fetch request.
    try {
        // Use 'fetch' to send a POST request to the local Python/Flask server.
        // The URL is constructed with the specific endpoint for the requested job.
        const response = await fetch(`http://127.0.0.1:5001/${endpoint}`, {
            method: 'POST', // Specify the HTTP method.
            headers: { 'Content-Type': 'application/json' }, // Set the content type header.
            body: JSON.stringify(body), // Convert the JavaScript object to a JSON string for the request body.
        });

        // Parse the JSON response from the Python server.
        const result = await response.json();

        // Check if the HTTP response status is not 'ok' (i.e., not in the 200-299 range).
        if (!response.ok) {
            // If the response is not ok, throw a new error to be caught by the catch block.
            // Use the error message from the backend if available, otherwise use a generic message.
            throw new Error(result.error || 'An unknown backend error occurred.');
        }

        // If the request was successful, return the result to the caller (the ipcMain.handle function).
        return result;

    } catch (error) {
        // If any error occurred in the 'try' block, it will be caught here.
        // Log the detailed error message to the main process console (the terminal where you run the app).
        console.error(`[Main Process Error] Failed to call ${endpoint}:`, error);
        // Re-throw the error. This is crucial because it sends the error back to the renderer process,
        // so the UI can catch it and display a message to the user.
        throw new Error(error.message);
    }
}

// --- App Lifecycle Events ---

// The 'ready' event is fired when Electron has finished initialization.
app.on('ready', () => {
    // Start the Python backend service when the app is ready.
    startPythonBackend();

    // Set up handlers for IPC messages from the renderer process.
    // 'ipcMain.handle' is used for two-way, asynchronous communication.
    ipcMain.handle('start-single-mp3-job', (event, args) => handleJobRequest('start-single-mp3-job', args));
    ipcMain.handle('start-playlist-zip-job', (event, args) => handleJobRequest('start-playlist-zip-job', args));
    ipcMain.handle('start-combine-mp3-job', (event, args) => handleJobRequest('start-combine-playlist-mp3-job', args));
    ipcMain.handle('get-job-status', (event, args) => handleJobRequest('job-status', args));

    // Call the function to create the main application window.
    createWindow();
});

// The 'window-all-closed' event is fired when all application windows have been closed.
app.on('window-all-closed', () => {
    // On Windows and Linux, quitting the app is the standard behavior.
    // 'process.platform' is 'darwin' for macOS.
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// The 'activate' event is fired on macOS when the dock icon is clicked and there are no other windows open.
app.on('activate', () => {
    // If the app is active but has no windows open, create a new one.
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// The 'will-quit' event is fired just before the application starts closing its windows.
app.on('will-quit', () => {
    // Check if the 'pythonProcess' variable is holding a running process.
    if (pythonProcess) {
        // Log that we are killing the process.
        console.log('Killing Python backend process.');
        // Terminate the Python child process to prevent it from becoming a zombie process.
        pythonProcess.kill();
    }
});
