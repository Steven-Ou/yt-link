const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const portfinder = require('portfinder');
const fetch = require('node-fetch');
const fs = require('fs');
const os = require('os');

let pythonProcess = null;
let mainWindow = null;
let pyPort = null;
let isBackendReady = false;

// Function to send logs to the renderer process
function sendLog(message) {
    if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('backend-log', message);
    }
    console.log(message);
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

    const urlToLoad = app.isPackaged
        ? `file://${path.join(__dirname, 'frontend', 'out', 'index.html')}`
        : 'http://localhost:3000';
    
    mainWindow.loadURL(urlToLoad);

    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools();
    }
}

function startPythonBackend(port) {
    const isDev = !app.isPackaged;
    
    const command = isDev 
        ? (process.platform === 'win32' ? 'python' : 'python3') 
        : path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend');

    // **DEFINITIVE FIX**: The ONLY argument passed to the Python script is the port number.
    // This prevents the instant crash. The ffmpeg path is now handled per-job.
    const args = isDev 
        ? [path.join(__dirname, 'service', 'app.py'), port.toString()]
        : [port.toString()];
    
    sendLog(`[Electron] Starting backend with command: ${command} ${args.join(' ')}`);
    
    pythonProcess = spawn(command, args);

    // This logging setup will now work because the Python process won't crash instantly.
    pythonProcess.stdout.on('data', (data) => {
        const log = data.toString().trim();
        sendLog(`[Python STDOUT]: ${log}`);
        if (log.includes(`Flask-Backend-Ready:${port}`)) {
            isBackendReady = true;
        }
    });
    
    pythonProcess.stderr.on('data', (data) => {
        sendLog(`[Python STDERR]: ${data.toString().trim()}`);
    });
    
    pythonProcess.on('close', (code) => {
        isBackendReady = false;
        sendLog(`[Electron] Python process exited with code ${code}`);
        if (code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
             dialog.showErrorBox('Backend Error', `The backend service stopped unexpectedly (code: ${code}). Please check the logs or restart the application.`);
        }
    });
}

app.on('ready', createWindow);
app.on('window-all-closed', () => app.quit());
app.on('quit', () => pythonProcess?.kill());

// IPC handler to start a job
ipcMain.handle('start-job', async (event, { jobType, url, cookies }) => {
    if (!isBackendReady) {
        return { error: 'Backend is not ready. Please wait a moment or restart the application.' };
    }
    
    // **DEFINITIVE FIX**: Calculate the correct ffmpeg path here and send it inside the job's JSON payload.
    // This is much more reliable than using command-line arguments.
    const isDev = !app.isPackaged;
    const ffmpegPath = isDev 
        ? path.join(__dirname, 'bin')
        : path.join(process.resourcesPath, 'bin');

    // Construct the payload with all necessary information.
    const payload = { jobType, url, cookies, ffmpeg_location: ffmpegPath };

    try {
        sendLog(`[Electron] Sending job to Python backend: ${JSON.stringify(payload)}`);
        const response = await fetch(`http://127.0.0.1:${pyPort}/start-job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `Python backend returned status ${response.status}`);
        }
        return result;
    } catch (error) {
        sendLog(`[Electron] ERROR: Failed to communicate with backend: ${error.message}`);
        return { error: `Failed to communicate with backend: ${error.message}` };
    }
});

// Other IPC handlers remain unchanged...
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
        const filePath = path.join(downloadsPath, job.file_name);
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
        dialog.showErrorBox('Download Error', `Could not download the file: ${error.message}`);
        return { error: error.message };
    }
});

ipcMain.handle('open-folder', (event, folderPath) => {
    if (folderPath && fs.existsSync(folderPath)) {
        shell.showItemInFolder(folderPath);
    } else {
        sendLog(`[Electron] ERROR: Attempted to open non-existent path: ${folderPath}`);
    }
});
