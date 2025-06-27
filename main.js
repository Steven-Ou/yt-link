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

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function startPythonBackend(port) {
    const isDev = !app.isPackaged;
    
    const command = isDev 
        ? (process.platform === 'win32' ? 'python' : 'python3') 
        : path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend');

    const args = isDev 
        ? [path.join(__dirname, 'service', 'app.py'), port.toString()]
        : [port.toString()];
    
    // --- DEFINITIVE FIX: Create a new environment for the child process ---
    // This reliably provides the path to the bundled binaries.
    const binPath = isDev ? path.join(__dirname, 'bin') : path.join(process.resourcesPath, 'bin');
    const newEnv = { ...process.env };
    newEnv.PATH = `${binPath}${path.delimiter}${newEnv.PATH}`;

    const options = {
        env: newEnv,
    };
    // --- END FIX ---
    
    sendLog(`[Electron] Starting backend: ${command} ${args.join(' ')}`);
    sendLog(`[Electron] Augmenting backend PATH with: ${binPath}`);
    
    // Pass the corrected environment options to the spawn call
    pythonProcess = spawn(command, args, options);

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
    });
}

app.on('ready', createWindow);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
app.on('quit', () => pythonProcess && pythonProcess.kill());

// --- IPC HANDLERS ---

ipcMain.handle('start-job', async (event, { jobType, url, cookies }) => {
    if (!isBackendReady) {
        return { error: 'Backend is not ready. Please wait a moment or restart the application.' };
    }
    
    // The ffmpeg_location is no longer needed in the payload
    const payload = { jobType, url, cookies };

    try {
        sendLog(`[Electron] Sending job to Python: ${JSON.stringify(payload)}`);
        const response = await fetch(`http://127.0.0.1:${pyPort}/start-job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return await response.json();
    } catch (error) {
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
