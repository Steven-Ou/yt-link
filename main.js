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

// **RE-IMPLEMENTED**: Function to send logs from main to renderer for debugging.
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
            // Preload script is essential for the context bridge.
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

    // **CRITICAL FIX**: Corrected the path for loading the frontend.
    // In development, we load from the dev server.
    // In a packaged app, the 'frontend/out' folder is at the root of the resources directory.
    const urlToLoad = app.isPackaged
        ? `file://${path.join(process.resourcesPath, 'frontend', 'out', 'index.html')}`
        : 'http://localhost:3000';
    
    sendLog(`[Electron] Loading URL: ${urlToLoad}`);
    mainWindow.loadURL(urlToLoad)
      .catch(err => {
        sendLog(`[Electron] ERROR: Failed to load URL: ${urlToLoad}`);
        sendLog(err);
        dialog.showErrorBox('Load Error', `Failed to load the application window. Please check the logs.\n${err}`);
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
    
    // Path to the backend executable is different in dev vs. packaged app
    const command = isDev 
        ? (process.platform === 'win32' ? 'python' : 'python3') 
        : path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend');

    // The main app.py script is in the 'service' folder during development
    const args = isDev 
        ? [path.join(__dirname, '..', 'service', 'app.py'), port.toString()]
        : [port.toString()];
    
    // In development, the 'service' directory is the working directory for python.
    // In production, the backend runs from the root of the resources path.
    const cwd = isDev ? path.join(__dirname, '..', 'service') : process.resourcesPath;

    sendLog(`[Electron] Starting backend: ${command} ${args.join(' ')}`);
    sendLog(`[Electron] Backend CWD: ${cwd}`);
    
    pythonProcess = spawn(command, args, { cwd });

    pythonProcess.stdout.on('data', (data) => {
        const log = data.toString().trim();
        // Forward Python's stdout to the renderer console
        sendLog(`[Python STDOUT]: ${log}`);
        if (log.includes(`Flask-Backend-Ready:${port}`)) {
            isBackendReady = true;
            sendLog('[Electron] Backend is ready.');
        }
    });
    
    pythonProcess.stderr.on('data', (data) => {
        // Forward Python's stderr to the renderer console
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
    
    // Determine the path to the ffmpeg binaries and pass it to Python.
    const ffmpegPath = app.isPackaged
        ? path.join(process.resourcesPath, 'bin')
        : path.resolve(__dirname, '..', 'bin'); // Use resolve for a robust dev path

    const payload = { jobType, url, cookies, ffmpeg_location: ffmpegPath };

    try {
        sendLog(`[Electron] Sending job to Python: ${JSON.stringify(payload)}`);
        const response = await fetch(`http://127.0.0.1:${pyPort}/start-job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`Backend responded with status: ${response.status}`);
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
        // Ensure the filename is sanitized before creating the path
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
