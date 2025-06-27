const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const portfinder = require('portfinder');
const fetch = require('node-fetch');
const fs = require('fs');

let pythonProcess = null;
let mainWindow = null;
let pyPort = null;
let isBackendReady = false;

// Function to send logs from the main process to the renderer for debugging
function sendLog(message) {
    console.log(message);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('backend-log', message);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        title: "YT Link"
    });

    portfinder.getPortPromise({ port: 5001 })
        .then(freePort => {
            pyPort = freePort;
            startPythonBackend(pyPort);
        })
        .catch(err => {
            dialog.showErrorBox('Startup Error', 'Could not find a free port for the backend service.');
            app.quit();
        });

    // This path correctly loads the frontend from the asar archive in the packaged app.
    const urlToLoad = app.isPackaged
        ? `file://${path.join(__dirname, 'frontend/out/index.html')}`
        : 'http://localhost:3000';
    
    sendLog(`[Electron] Loading URL: ${urlToLoad}`);
    mainWindow.loadURL(urlToLoad)
      .catch(err => {
        const errorString = JSON.stringify(err, Object.getOwnPropertyNames(err));
        sendLog(`[Electron] FATAL: Failed to load URL: ${urlToLoad}. Error: ${errorString}`);
        dialog.showErrorBox('Load Error', `Failed to load the application window. Please check the logs.\n${errorString}`);
      });


    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function startPythonBackend(port) {
    const isDev = !app.isPackaged;
    
    const backendName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';

    const command = isDev 
        ? (process.platform === 'win32' ? 'python' : 'python3') 
        : path.join(process.resourcesPath, 'backend', backendName);

    const args = isDev 
        ? [path.join(__dirname, '..', 'service', 'app.py'), port.toString()]
        : [port.toString()];
    
    const cwd = isDev ? path.join(__dirname, '..', 'service') : path.dirname(command);

    // **DEFINITIVE FFMPEG FIX**: Modify the environment for the spawned process.
    // This makes `ffmpeg` and `ffprobe` available directly on the PATH for the Python script.
    const binPath = isDev
        ? path.resolve(__dirname, '..', 'bin')
        : path.join(process.resourcesPath, 'bin');
    
    const newEnv = { ...process.env };
    newEnv.PATH = `${binPath}${path.delimiter}${newEnv.PATH}`;
    
    sendLog(`[Electron] Starting backend: ${command} ${args.join(' ')}`);
    sendLog(`[Electron] Augmenting backend PATH with: ${binPath}`);
    
    pythonProcess = spawn(command, args, { cwd, env: newEnv });

    pythonProcess.stdout.on('data', (data) => {
        const log = data.toString().trim();
        sendLog(`[Python STDOUT]: ${log}`);
        if (log.includes(`Flask-Backend-Ready:${port}`)) {
            isBackendReady = true;
            sendLog('[Electron] Backend is ready.');
        }
    });
    
    pythonProcess.stderr.on('data', (data) => {
        sendLog(`[Python STDERR]: ${data.toString().trim()}`);
    });
    
    pythonProcess.on('close', (code) => {
        isBackendReady = false;
        sendLog(`[Electron] Python process exited with code ${code}`);
    });
}

app.on('ready', createWindow);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
app.on('quit', () => {
    if (pythonProcess) {
        pythonProcess.kill();
    }
});

// --- IPC HANDLERS ---

ipcMain.handle('start-job', async (event, { jobType, url, cookies }) => {
    if (!isBackendReady) {
        return { error: 'Backend is not ready. Please wait a moment or restart the application.' };
    }
    
    // **DEFINITIVE FFMPEG FIX**: The `ffmpeg_location` is no longer needed in the payload
    // because the backend process is now launched with the correct PATH environment variable.
    const payload = { jobType, url, cookies };

    try {
        sendLog(`[Electron] Sending job to Python: ${JSON.stringify(payload)}`);
        const response = await fetch(`http://127.0.0.1:${pyPort}/start-job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`Backend responded with status: ${response.status} ${await response.text()}`);
        }
        return await response.json();
    } catch (error) {
        sendLog(`[Electron] ERROR: Failed to communicate with backend: ${error.message}`);
        return { error: `Failed to communicate with backend: ${error.message}` };
    }
});

ipcMain.handle('get-job-status', async (event, jobId) => {
    if (!isBackendReady) return { status: 'failed', message: 'Backend is not running.' };
    try {
        const response = await fetch(`http://127.0.0.1:${pyPort}/job-status?jobId=${jobId}`);
        return await response.json();
    } catch (error) {
        return { error: error.message };
    }
});

ipcMain.handle('download-file', async (event, jobId) => {
    if (!isBackendReady) return { error: 'Backend is not running.' };
    try {
        const jobStatusUrl = `http://127.0.0.1:${pyPort}/job-status?jobId=${jobId}`;
        const statusResponse = await fetch(jobStatusUrl);
        const job = await statusResponse.json();

        if (job.status !== 'completed' || !job.file_name) {
            return { error: 'File is not ready for download.' };
        }
        
        const downloadsPath = app.getPath('downloads');
        const safeFileName = job.file_name.replace(/[\/\\]/g, '_');
        const filePath = path.join(downloadsPath, safeFileName);
        
        const downloadUrl = `http://127.0.0.1:${pyPort}/download/${jobId}`;
        const downloadResponse = await fetch(downloadUrl);

        if (!downloadResponse.ok) throw new Error(`Backend download error: ${await downloadResponse.text()}`);

        const fileStream = fs.createWriteStream(filePath);
        await new Promise((resolve, reject) => {
            downloadResponse.body.pipe(fileStream);
            downloadResponse.body.on("error", reject);
            fileStream.on("finish", resolve);
        });

        return { success: true, path: filePath };
    } catch(error) {
        sendLog(`[Electron] Download Error: ${error.message}`);
        dialog.showErrorBox('Download Error', `Could not download the file: ${error.message}`);
        return { error: error.message };
    }
});

ipcMain.handle('open-folder', (event, folderPath) => {
    if (folderPath && fs.existsSync(folderPath)) {
        shell.showItemInFolder(folderPath);
    } else {
        sendLog(`[Electron] ERROR: Attempted to open non-existent path: ${folderPath}`);
        dialog.showErrorBox('File Not Found', `The path does not exist: ${folderPath}`);
    }
});
