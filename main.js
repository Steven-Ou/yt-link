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

function sendLog(message) {
    console.log(message);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('backend-log', message);
    }
}

function loadMainWindow() {
    const urlToLoad = !app.isPackaged
        ? 'http://localhost:3000'
        : `file://${path.join(__dirname, 'frontend/out/index.html')}`;
    
    sendLog(`[Electron] Attempting to load URL: ${urlToLoad}`);
    
    mainWindow.loadURL(urlToLoad).catch(err => {
        sendLog(`[Electron] First load attempt failed: ${err.message}. Retrying in 2 seconds...`);
        setTimeout(() => {
            mainWindow.loadURL(urlToLoad).catch(err2 => {
                const errorString = JSON.stringify(err2, Object.getOwnPropertyNames(err2));
                sendLog(`[Electron] FATAL: Failed to load URL on second attempt: ${urlToLoad}. Error: ${errorString}`);
                dialog.showErrorBox('Fatal Load Error', `The application window failed to load twice. Please restart the app or check logs.\n${errorString}`);
            });
        }, 2000);
    });
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

    sendLog('[Electron] Finding a free port...');
    portfinder.getPortPromise({ port: 5001 })
        .then(freePort => {
            sendLog(`[Electron] Found free port: ${freePort}`);
            pyPort = freePort;
            startPythonBackend(pyPort);
        })
        .catch(err => {
            const errorMessage = `Could not find a free port for the backend service.\n\nError: ${err.message}`;
            sendLog(`[Electron] Portfinder error: ${errorMessage}`);
            dialog.showErrorBox('Startup Error', errorMessage);
            app.quit();
        });

    loadMainWindow();
    
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
    const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

    const command = isDev 
        ? (process.platform === 'win32' ? 'python' : 'python3') 
        : path.join(process.resourcesPath, 'backend', backendName);

    // --- THIS IS THE FIX ---
    // In development mode, we now add the "-X utf8" flag to force Python's I/O to use UTF-8.
    // This prevents UnicodeEncodeError on Windows when printing filenames with special characters.
    const args = isDev 
        ? ['-X', 'utf8', path.join(__dirname, 'service', 'app.py'), port.toString()]
        : [port.toString(), path.join(process.resourcesPath, 'bin', ffmpegName)];
    
    sendLog(`[Electron] Starting backend with command: "${command}"`);
    sendLog(`[Electron] Using arguments: [${args.join(', ')}]`);
    
    pythonProcess = spawn(command, args);

    pythonProcess.on('error', (err) => {
        sendLog(`[Electron] FAILED TO START PYTHON PROCESS: ${err}`);
        dialog.showErrorBox('Backend Error', `Failed to start the backend service:\n${err}`);
    });

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
        if (code !== 0 && !isBackendReady) {
            dialog.showErrorBox('Backend Error', `The backend service failed to start or closed unexpectedly with code: ${code}. Please check the logs.`);
        }
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

// --- IPC HANDLERS (No changes below this line) ---
ipcMain.handle('start-job', async (event, { jobType, url, cookies }) => {
    if (!isBackendReady) {
        return { error: 'Backend is not ready. Please wait a moment or restart the application.' };
    }
    
    const payload = { jobType, url, cookies };

    try {
        sendLog(`[Electron] Sending job to Python with payload: ${JSON.stringify(payload)}`);
        const response = await fetch(`http://127.0.0.1:${pyPort}/start-job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Backend responded with status: ${response.status} ${errorText}`);
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
        const response = await fetch(`http://12-7.0.0.1:${pyPort}/job-status?jobId=${jobId}`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Backend responded with status: ${response.status} ${errorText}`);
        }
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
        const safeFileName = job.file_name.replace(/[\\/]/g, '_');
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
