// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const tcpPortUsed = require('tcp-port-used');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const FLASK_PORT = 8080;
const NEXTJS_DEV_URL ='http://localhost:3000';

let mainWindow;
let flaskProcess = null;

// Configure auto-updater
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');
autoUpdater.autoDownload = false;

function startFlaskServer() {
    log.info('Attempting to start backend server...');
    let backendPath;
    let backendArgs = [];

    if (app.isPackaged) {
        const resourcesPath = process.resourcesPath;
        const exeName = process.platform === 'win32' ? 'app.exe' : 'app';
        backendPath = path.join(resourcesPath, 'service', exeName);
    } else {
        const flaskAppDirectory = path.join(__dirname, '..', 'service');
        backendPath = process.platform === 'win32' 
            ? path.join(flaskAppDirectory, 'venv', 'Scripts', 'python.exe')
            : path.join(flaskAppDirectory, 'venv', 'bin', 'python');
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
    
    // Log backend output for debugging
    flaskProcess.stdout.on('data', (data) => log.info(`Backend STDOUT: ${data.toString().trim()}`));
    flaskProcess.stderr.on('data', (data) => log.error(`Backend STDERR: ${data.toString().trim()}`));
    flaskProcess.on('close', (code) => {
        log.info(`Backend process exited with code ${code}`);
        flaskProcess = null;
    });
    flaskProcess.on('error', (err) => {
        log.error('Failed to run backend process.', err);
        dialog.showErrorBox('Backend Server Error', `Failed to start/run the local server: ${err.message}`);
    });
} 

function stopFlaskServer(){
    if(flaskProcess){
        log.info('Stopping backend server...');
        flaskProcess.kill();
        flaskProcess = null;
    }
}

function createWindow(){
    mainWindow = new BrowserWindow({ 
        width: 1280, 
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    if (!app.isPackaged) {
        mainWindow.loadURL(NEXTJS_DEV_URL);
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, 'out', 'index.html'));
    }
    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
    startFlaskServer(); 
    try {
        log.info(`Waiting for backend server on port ${FLASK_PORT}...`);
        await tcpPortUsed.waitUntilUsed(FLASK_PORT, 500, 20000);
        log.info(`Backend server detected on port ${FLASK_PORT}.`);
        createWindow();

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
        log.error(`Backend server did not start in time:`, err);
        dialog.showErrorBox('Server Error', `The local backend did not start correctly.`);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('will-quit', stopFlaskServer);

// --- Auto-Updater Event Listeners ---
autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
        type: "info", title: "Update Available",
        message: `A new version (${info.version}) is available. Do you want to download it now?`,
        buttons: ['Download Now', 'Later']
    }).then(result => {
        if (result.response === 0) autoUpdater.downloadUpdate();
    });
});
autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
        type: 'info', title: 'Update Ready to Install',
        message: 'A new version has been downloaded. Restart the application to apply the updates.',
        buttons: ['Restart Now', 'Later']
    }).then(result => {
        if (result.response === 0) autoUpdater.quitAndInstall();
    });
});
autoUpdater.on('error', (err) => log.error('Updater Error: ' + err));
autoUpdater.on('checking-for-update', () => log.info('Checking for update...'));
autoUpdater.on('update-not-available', () => log.info('Update not available.'));
autoUpdater.on('download-progress', (p) => log.info(`Download speed: ${p.bytesPerSecond} - Downloaded ${p.percent}%`));
