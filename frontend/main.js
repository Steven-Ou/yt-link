// main.js

// --- Core Electron & Node.js Modules ---
// 'app' controls your application's event lifecycle.
// 'BrowserWindow' creates and manages application windows.
// 'ipcMain' handles asynchronous and synchronous messages sent from the renderer process (your web page).
// 'dialog' lets you display native system dialogs for opening files, showing alerts, etc.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');

// The 'path' module provides utilities for working with file and directory paths in a cross-platform way.
const path = require('path');

// The 'spawn' function from 'child_process' is used to run external commands, like our Python server.
const { spawn } = require('child_process');

// The 'tcp-port-used' module helps us check if our Python server has successfully started on its port.
const tcpPortUsed = require('tcp-port-used');

// The 'autoUpdater' object from 'electron-updater' handles all the logic for checking and applying updates.
const { autoUpdater } = require('electron-updater');

// The 'electron-log' module provides a simple logging system that works in both development and production.
const log = require('electron-log');


// --- Application Configuration ---
// Defines the port number that the local Python Flask server will run on.
const FLASK_PORT = 8080;
// Defines the URL for the Next.js development server, which allows for hot-reloading.
const NEXTJS_DEV_URL ='http://localhost:3000';


// --- Global Variables ---
// This variable will hold the reference to our main application window.
let mainWindow;
// This variable will hold the reference to the running Python backend process.
let flaskProcess = null;


// --- Auto Updater Configuration & Logging ---
// Directs the autoUpdater to use electron-log for its output, which is useful for debugging updates.
autoUpdater.logger = log;
// Sets the logging level for the updater's log file.
autoUpdater.logger.transports.file.level = 'info';
// Logs a message to indicate that the application is starting.
log.info('App starting...');
// Disables automatic downloading of updates. The app will now prompt the user before downloading.
autoUpdater.autoDownload = false;


// --- Backend Server Management ---
// This function starts the Python backend server.
function startFlaskServer() {
    // Logs that the function has been called.
    log.info('Attempting to start backend server...');
    // A variable to hold the path to the executable we need to run.
    let backendPath;
    // A variable to hold any command-line arguments for the executable.
    let backendArgs = [];

    // 'app.isPackaged' is a built-in Electron property. It's 'true' for the final installed app
    // and 'false' when running in development mode (with `npm run electron:dev`).
    if (app.isPackaged) {
        // --- PRODUCTION MODE (macOS and Windows) ---
        // 'process.resourcesPath' is the path to the 'resources' folder inside the packaged app.
        const resourcesPath = process.resourcesPath;
        // The executable name depends on the platform
        const exeName = process.platform === 'win32' ? 'app.exe' : 'app';
        // We construct the full path to our backend executable.
        backendPath = path.join(resourcesPath, 'service', exeName);
    } else {
        // --- DEVELOPMENT MODE ---
        // We build the path to our local 'service' folder relative to the current file.
        const flaskAppDirectory = path.join(__dirname, '..', 'service');
        // The path to the Python executable differs between Windows and macOS/Linux.
        backendPath = process.platform === 'win32' 
            ? path.join(flaskAppDirectory, 'venv', 'Scripts', 'python.exe')
            : path.join(flaskAppDirectory, 'venv', 'bin', 'python');
        // In development, we always tell Python to run our 'app.py' script.
        backendArgs = [path.join(flaskAppDirectory, 'app.py')];
    }

    // Logs the exact command that is about to be executed. This is great for debugging.
    log.info(`Executing backend command: ${backendPath} ${backendArgs.join(' ')}`);
    try {
        // The 'spawn' command runs the backend process.
        flaskProcess = spawn(backendPath, backendArgs);
    } catch (error) {
        // If 'spawn' itself fails (e.g., file not found), log it and show an error.
        log.error('Spawn failed to initiate backend process.', error);
        dialog.showErrorBox('Critical Error', `Could not launch the local server: ${error.message}`);
        app.quit(); // Quit the app because it cannot function without the backend.
        return;
    }
    
    // --- Event Listeners for the Backend Process ---
    // Listens for any standard output (like print statements) from the backend and logs it.
    flaskProcess.stdout.on('data', (data) => log.info(`Backend STDOUT: ${data.toString().trim()}`));
    // Listens for any error output from the backend and logs it.
    flaskProcess.stderr.on('data', (data) => log.error(`Backend STDERR: ${data.toString().trim()}`));
    // Listens for when the backend process closes and logs its exit code.
    flaskProcess.on('close', (code) => {
        log.info(`Backend process exited with code ${code}`);
        flaskProcess = null;
    });
    // Listens for any errors related to the process itself (e.g., permissions issues).
    flaskProcess.on('error', (err) => {
        log.error('Failed to run backend process.', err);
        dialog.showErrorBox('Backend Server Error', `Failed to start/run the local server: ${err.message}`);
    });
} 

// This function stops the Python backend server.
function stopFlaskServer(){
    // Checks if the backend process is currently running.
    if(flaskProcess){
        // Logs the intention to stop the server.
        log.info('Stopping backend server...');
        // The 'kill()' command sends a termination signal to the process.
        flaskProcess.kill();
        // Sets the variable to null to indicate the process is stopped.
        flaskProcess = null;
    }
}

// --- Electron Window Creation ---
// This function creates the main application window.
function createWindow(){
    // Creates a new browser window instance with specified dimensions.
    mainWindow = new BrowserWindow({ 
        width: 1280, 
        height: 800,
        // Web Preferences control the features of the web page inside the window.
        webPreferences: {
            nodeIntegration: false, // Disables Node.js in the renderer for security.
            contextIsolation: true, // Creates a separate JavaScript context for security.
            preload: path.join(__dirname, 'preload.js'), // Specifies a script to run before the web page loads.
        },
    });

    // Checks if the app is in development or production using Electron's built-in property.
    if (!app.isPackaged) {
        // In development, load the URL from the Next.js hot-reloading server.
        mainWindow.loadURL(NEXTJS_DEV_URL);
        // Automatically open the browser's Developer Tools for debugging.
        mainWindow.webContents.openDevTools();
    } else {
        // In production, load the pre-built 'index.html' file from the 'out' folder.
        mainWindow.loadFile(path.join(__dirname, 'out', 'index.html'));
    }
    // Event listener for when the window is closed.
    mainWindow.on('closed', () => { mainWindow = null; });
}

// --- Application Lifecycle Management ---
// This event fires when Electron has finished initialization.
app.whenReady().then(async () => {
    // We start our backend server as soon as the app is ready.
    startFlaskServer(); 
    try {
        // Log that we are now waiting for the server to be available on its port.
        log.info(`Waiting for backend server on port ${FLASK_PORT}...`);
        // This will pause execution until the port is in use, or 20 seconds have passed.
        await tcpPortUsed.waitUntilUsed(FLASK_PORT, 500, 20000);
        // If the port becomes active, log the success and create the app window.
        log.info(`Backend server detected on port ${FLASK_PORT}.`);
        createWindow();

        // Only check for updates when the app is packaged and installed.
        if (app.isPackaged) {
            log.info('Production mode: Checking for application updates...');
            // FIX: This try/catch block prevents a crash if app-update.yml is not found (e.g., in portable mode).
            setTimeout(() => {
                try {
                    autoUpdater.checkForUpdates();
                } catch (updateError) {
                    log.error('Error initiating update check (likely portable mode):', updateError.message);
                    if (mainWindow) mainWindow.webContents.send('update-status', 'Auto-updates disabled for this version.');
                }
            }, 5000);
        }
    } catch (err) {
        // This 'catch' block runs if the port is NOT in use after the timeout.
        log.error(`Backend server did not start in time:`, err);
        dialog.showErrorBox('Server Error', `The local backend did not start correctly.`);
        // Quit the app because it cannot function.
        app.quit();
    }
});

// This event is for macOS. It re-creates the window if the dock icon is clicked and no windows are open.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
// This event handles re-opening the app on macOS from the dock.
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
// This event fires just before the application begins to close its windows.
app.on('will-quit', stopFlaskServer);

// --- Auto-Updater Event Listeners ---
// Fired when an update is found.
autoUpdater.on('update-available', (info) => {
    // Shows a native dialog box to the user.
    dialog.showMessageBox({
        type: "info", title: "Update Available",
        message: `A new version (${info.version}) is available. Do you want to download it now?`,
        buttons: ['Download Now', 'Later']
    }).then(result => {
        // Starts the download if the user clicks "Download Now".
        if (result.response === 0) autoUpdater.downloadUpdate();
    });
});
// Fired when the update has been fully downloaded.
autoUpdater.on('update-downloaded', () => {
    // Shows another dialog to ask the user to restart.
    dialog.showMessageBox({
        type: 'info', title: 'Update Ready to Install',
        message: 'A new version has been downloaded. Restart the application to apply the updates.',
        buttons: ['Restart Now', 'Later']
    }).then(result => {
        // Quits the app and installs the update if the user agrees.
        if (result.response === 0) autoUpdater.quitAndInstall();
    });
});
// These listeners log various stages of the update process for debugging.
autoUpdater.on('error', (err) => log.error('Updater Error: ' + err));
autoUpdater.on('checking-for-update', () => log.info('Checking for update...'));
autoUpdater.on('update-not-available', () => log.info('Update not available.'));
autoUpdater.on('download-progress', (p) => log.info(`Download speed: ${p.bytesPerSecond} - Downloaded ${p.percent}%`));
