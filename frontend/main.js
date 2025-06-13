//main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // Importing app and BrowserWindow from electron
const path = require('path'); // Importing path module
const { spawn } = require('child_process'); // Importing spawn from child_process module
const tcpPortUsed = require('tcp-port-used'); // Importing tcp-port-used module
const { autoUpdater } = require('electron-updater'); // Importing autoUpdater from electron-updater module
const log = require('electron-log'); // Importing electron-log module

// --- Configuration ---
const FLASK_PORT = 8080; // Port for Flask server
const NEXTJS_DEV_URL ='http://localhost:3000'; // URL for Next.js development server

let mainWindow; // Variable to hold the main window instance
let flaskProcess = null; // Variable to hold the Flask process instance

// --- Auto Updater Configuration & Logging  ---
autoUpdater.logger = log; // Set the logger for autoUpdater
autoUpdater.logger.transports.file.level = 'info'; // Set the log level to info
log.info('App starting...'); // Log the app starting message

// Disable auto-download: USER WILL BE THE ONE CONSENTING TO DOWNLOAD
autoUpdater.autoDownload = false; // Disable auto-download for updates

//--- Flask Server Mangement --- 
function startFlaskServer() {
    log.info('Attempting to start backend server...');
    let backendPath;
    let backendArgs = [];

    if (app.isPackaged) {
        // In PRODUCTION, we look for the backend inside the app's resources directory.
        const resourcesPath = process.resourcesPath;
        if (process.platform === 'win32') {
            // On Windows, we run the bundled app.exe
            backendPath = path.join(resourcesPath, 'service', 'app.exe');
        } else {
            // On Mac, we run the bundled Python script from the venv
            const flaskAppDirectory = path.join(resourcesPath, 'service');
            backendPath = path.join(flaskAppDirectory, 'venv', 'bin', 'python');
            backendArgs = [path.join(flaskAppDirectory, 'app.py')];
        }
    } else {
        // In DEVELOPMENT, we run the Python script directly from the project source.
        const flaskAppDirectory = path.join(__dirname, '..', 'service');
        if (process.platform === 'win32') {
            backendPath = path.join(flaskAppDirectory, 'venv', 'Scripts', 'python.exe');
        } else {
            backendPath = path.join(flaskAppDirectory, 'venv', 'bin', 'python');
        }
        backendArgs = [path.join(flaskAppDirectory, 'app.py')];
    }

    log.info(`Executing backend command: ${backendPath} ${backendArgs.join(' ')}`);

    try {
        flaskProcess = spawn(backendPath, backendArgs);
    } catch (error) {
        log.error('Spawn failed to initiate backend process.', error);
        dialog.showErrorBox('Critical Error', `Could not launch the local server: ${error.message}`);
        app.quit();
        return;
    }
    
    flaskProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        if (output) log.info(`Backend STDOUT: ${output}`);
    });
    flaskProcess.stderr.on('data', (data) => {
        const errorOutput = data.toString().trim();
        if (errorOutput) log.error(`Backend STDERR: ${errorOutput}`);
    });
    flaskProcess.on('close', (code, signal) => {
        log.info(`Backend process exited with code ${code} and signal ${signal}`);
        flaskProcess = null;
    });
    flaskProcess.on('error', (err) => {
        log.error('Failed to start or run backend process.', err);
        dialog.showErrorBox('Backend Server Error', `Failed to start/run the local server: ${err.message}`);
        flaskProcess = null;
    });
} 

// Function to stop the Flask server
function stopFlaskServer(){
    if(flaskProcess){
        log.info('Attempting to stop Backend Server...');// Log the message indicating backend server is stopping 
        const killed = flaskProcess.kill();// Attempt to kill the backend process 
        if(killed){
            log.info('Backend Server process kill signal sent.');// Log the message indicating backend server process kill signal is sent
        }else{
            log.warn("Failed to send kill signal to Backend Server Process (Might've exited).");// Log warning if failed to send kill signal to backend server process 
        }
        flaskProcess=null;// Set flaskProcess to null after stopping it
    }
}

// --- Electron Window Creation ---
function createWindow(){
    mainWindow = new BrowserWindow({ 
        width:1280,
        height:800,
        webPreferences:{
            nodeIntegration:false, // Disable Node.js integration for security
            contextIsolation:true, // Enable context isolation for security
            preload: path.join(__dirname, 'preload.js'), // Use a preload script for secure context
        },
        // icon: path.join(__dirname, 'assets', 'icon.png'), // Note: icon path is usually configured in package.json build settings
    });

    // We now use app.isPackaged to determine if it's development or production
    if (!app.isPackaged) { //If in development mode
        log.info(`Loading Next.js from dev server: ${NEXTJS_DEV_URL} `);// Log the message indicating loading Next.js from dev server 
        mainWindow.loadURL(NEXTJS_DEV_URL); // Load the Next.js development server URL
        mainWindow.webContents.openDevTools(); // Open developer tools
    } else { //If in production mode
        const indexPath = path.join(__dirname, 'out', 'index.html'); // Correct path for next export
        log.info(`Loading Next.js from production build: ${indexPath}`);// Log the message indicating loading Next.js from production build
        mainWindow.loadFile(indexPath); // Load the exported Next.js HTML file
    }

    mainWindow.on('closed',()=>{
        log.info('Main window closed.'); // Log the message indicating main window is closed
        mainWindow = null;//Set mainWindow to null after it is closed 
    });
}

// --- Application Lifecycle Management ---
app.whenReady().then(async () => {// When the app is ready
    startFlaskServer(); 

    try {
        log.info(`Waiting for backend server on port ${FLASK_PORT}... (Timeout: 20s)`); //Log the message indicating waiting for backend server
        await tcpPortUsed.waitUntilUsed(FLASK_PORT, 500, 20000); //Poll every 500ms for 20s
        log.info(`Backend server detected on port ${FLASK_PORT}. Creating window...`);//Log the message indicating backend server is detected
        createWindow();// Create the main window

        // Check for updates only when the app is packaged (in production)
        if (app.isPackaged) {
            log.info('Production mode: Checking for application updates...');//Log the message indicating checking for application updates
            setTimeout(() => {// Wait for a bit before checking for updates
                autoUpdater.checkForUpdates().catch(err => {// Check for updates
                    log.error('Error during initial checkForUpdates:', err);//Log the error during initial check for updates
                });
            }, 5000);//Wait for 5 seconds before checking for updates
        } else {
            log.info('Development mode: Skipping update check.');//Log the message indicating skipping update check in development mode
        }
    } catch (err) {// If there is an error waiting for backend server
        log.error(`Backend Server did not start on port ${FLASK_PORT} within timeout:`, err); // Log the error if backend server did not start within timeout
        dialog.showErrorBox('Server Error', `The local backend server did not start correctly. The application will now close.`); // Show error dialog if backend server did not start correctly
        stopFlaskServer(); // Stop the backend server if it was started
        app.quit(); // Quit the application
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) { //If there are no open windows
            if (flaskProcess && !flaskProcess.killed) { // If backend process is running and not killed
                createWindow(); // Create the main window if it was closed
            } else {
                log.warn('Activate event: Backend process not running or killed, attempting to restart.');//Log warning if backend process is not running or killed 
                startFlaskServer();// Start the backend server again
                tcpPortUsed.waitUntilUsed(FLASK_PORT, 500, 10000)//Wait until backend server is up and running  
                    .then(() => createWindow())//Create the main window after backend server is up
                    .catch(errActivate => {//If there is an error waiting for backend server
                        log.error('Backend did not restart on activate:', errActivate);//Log the error if backend server did not restart
                        dialog.showErrorBox('Server Error', `The local backend could not be restarted. The application will now close.`);//Show error dialog if backend server could not be restarted
                        app.quit();// Quit the application 
                    });
            }
        }
    });
});

app.on('window-all-closed', () => {//When all windows are closed
    if (process.platform !== 'darwin') {
        app.quit(); //Quit the application if all windows are closed and not on macOS
    }
});

app.on('will-quit', () => {//When the application is about to quit
    log.info('Electron app will quit.');
    stopFlaskServer(); // Stop the backend server when the application is about to quit
});

// --- Auto-Updater Event Listeners ---
autoUpdater.on('checking-for-update', () => {//Event listener for autoUpdater events
    log.info('Updater: Checking for update...');//Log the message indicating checking for update
    if (mainWindow) { //If main window exists
        mainWindow.webContents.send('update-status', 'Checking for updates...');
    }
});

autoUpdater.on('update-available', (info) => {//Event listener for update available
    log.info('Updater: Update available.', info);//Log the message indicating update is available
    if (mainWindow) { //If main window exists
        mainWindow.webContents.send('update-status', `Update available: v${info.version}.`);
    }
    dialog.showMessageBox({
        type: "info", // Type of dialog
        title: "Update Available", // Title of dialog
        message: `A new version (${info.version}) of ${app.getName()} is available.`, // Message of dialog
        detail: `Release notes:\n${info.releaseNotes || 'No release notes provided.'}\n\nDo you want to download it now?`,
        buttons: ['Download Now', 'Later'], // Buttons for dialog
        defaultId: 0, // Default button index
        cancelId: 1 // Cancel button index
    }).then(result => {
        if (result.response === 0) { // User clicked "Download Now"
            log.info('Updater: User agreed to download. Starting download...');//Log the message indicating user agreed to download update
            if (mainWindow) {
                mainWindow.webContents.send('update-status', 'Downloading update...');
            }
            autoUpdater.downloadUpdate(); // Start downloading the update
        } else { // User clicked "Later"
            log.info('Updater: User deferred the update.');
            if (mainWindow) {
                mainWindow.webContents.send('update-status', 'Update deferred by user.');
            }
        }
    }).catch(err => {
        log.error('Updater: Error showing update available dialog:', err); // Log error if showing update dialog fails
    });
});

autoUpdater.on('update-not-available', (info) => {// Event listener for when no update is available
    log.info('Updater: Update not available.', info); // Log the message indicating update is not available
    if (mainWindow) { // If main window exists
        mainWindow.webContents.send('update-status', "You're on the latest version."); // Send message to renderer process about no updates available
    }
});

autoUpdater.on('error', (err) => {
    log.error('Updater: Error in auto-updater. ' + (err.stack || err.message || err)); // Log error if there is an error in auto-updater
    if (mainWindow) { // If main window exists
        mainWindow.webContents.send('update-status', `Error checking for updates: ${err.message}`); // Send message to renderer process about error in checking for updates
    }
});

autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent); // Calculate the percentage of download progress
    const transferredMB = Math.round(progressObj.transferred / (1024 * 1024)); // Calculate the transferred data in MB
    const totalMB = Math.round(progressObj.total / (1024 * 1024)); // Calculate the total data in MB
    const speedKBs = Math.round(progressObj.bytesPerSecond / 1024); // Calculate the download speed in KB/s

    let log_message = `Updater: Download speed: ${speedKBs} KB/s`; // Log message for download speed
    log_message += ` - Downloaded: ${percent}%`; // Append downloaded percentage to log message
    log_message += ` (${transferredMB}MB of ${totalMB}MB)`; // Append transferred and total data to log message
    log.info(log_message); // Log the download progress message

    if (mainWindow) {
        mainWindow.webContents.send('update-download-progress', { // Send download progress to renderer process
            percent,
            transferredMB,
            totalMB,
            speedKBs
        });
        mainWindow.webContents.send( // Send update status to renderer process
            'update-status', 
            `Downloading Update: ${percent}% (${transferredMB}MB / ${totalMB}MB) at ${speedKBs} KB/s`);
    }
});

autoUpdater.on('update-downloaded', (info) => { // Event listener for when update is downloaded
    log.info('Updater: Update downloaded. Ready to install.', info);
    if (mainWindow) mainWindow.webContents.send('update-status', `Update v${info.version} downloaded. Restart to install.`);
    dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready to Install',
        message: `Version ${info.version} of ${app.getName()} has been downloaded. Restart the application to apply the updates.`,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1
    }).then(result => {
        if (result.response === 0) {
            log.info('Updater: User chose to restart. Quitting and installing...');
            autoUpdater.quitAndInstall();
        } else {
            log.info('Updater: User chose to install later.');
            if (mainWindow) mainWindow.webContents.send('update-status', `Update v${info.version} will be installed on next restart.`);
        }
    });
});

ipcMain.on('renderer-action', (event, arg) => {
    log.info('Received renderer-action with arg:', arg); // Log the action received from renderer process
    event.reply('main-process-reply', 'Hello from main process!'); // Reply to renderer process with a message
});
