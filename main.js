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

function waitForBackend(timeout = 15000) { 
    return new Promise((resolve, reject) => {
        if (isBackendReady) return resolve(true);
        const startTime = Date.now();
        const interval = setInterval(() => {
            if (isBackendReady) {
                clearInterval(interval);
                resolve(true);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                const logPath = path.join(os.homedir(), 'yt_link_backend_debug.log');
                const errorMsg = `The Python backend service failed to start.\n\nPlease check the debug log file:\n${logPath}`;
                reject(new Error(errorMsg));
            }
        }, 250);
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

    portfinder.getPortPromise({ port: 5001 })
        .then(freePort => {
            pyPort = freePort;
            startPythonBackend(pyPort);
        })
        .catch(err => {
            console.error('[Electron] Could not find a free port.', err);
            dialog.showErrorBox('Startup Error', 'Could not find a free port for the backend service.');
            app.quit();
        });

    if (app.isPackaged) {
        mainWindow.loadFile(path.join(__dirname, 'frontend', 'out', 'index.html'));
    } else {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function startPythonBackend(port) {
    const isDev = !app.isPackaged;
    let command;
    let args;
    let spawnOptions = {};

    if (isDev) {
        command = (process.platform === 'win32' ? 'python' : 'python3');
        const scriptPath = path.join(__dirname, 'service', 'app.py');
        args = [scriptPath, port.toString()]; // **FIX**: Removed ffmpeg path from args
        spawnOptions.cwd = __dirname;
    } else {
        const exeName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
        command = path.join(process.resourcesPath, 'backend', exeName);
        args = [port.toString()]; // **FIX**: Removed ffmpeg path from args
        spawnOptions.cwd = path.dirname(command);
    }
    
    console.log(`[Electron] Starting backend with command: ${command} ${args.join(' ')}`);
    
    pythonProcess = spawn(command, args, spawnOptions);

    pythonProcess.stderr.on('data', (data) => console.error(`[Python STDERR]: ${data.toString()}`));
    pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`[Python STDOUT]: ${output}`);
        if (output.includes(`Flask-Backend-Ready:${port}`)) {
            isBackendReady = true;
            console.log('[Electron] Python backend is ready.');
        }
    });
    
    pythonProcess.on('close', (code) => {
        isBackendReady = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
             dialog.showErrorBox('Backend Error', `The backend service stopped unexpectedly. Please restart the application.`);
        }
    });
}

app.on('ready', createWindow);
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
    if (mainWindow === null) createWindow();
});
app.on('quit', () => {
    if (pythonProcess) pythonProcess.kill();
});

// --- IPC Handlers ---

ipcMain.handle('start-job', async (event, { jobType, url, cookies }) => {
    // **DEFINITIVE FIX**: Calculate ffmpeg path here and send it with the job payload.
    // This is the most reliable way to ensure Python gets the correct path every time.
    const isDev = !app.isPackaged;
    const ffmpegPath = isDev 
        ? path.join(__dirname, 'bin')
        : path.join(process.resourcesPath, 'bin');

    console.log(`[Job Start] Determined ffmpeg path for this job: ${ffmpegPath}`);
    if (!fs.existsSync(ffmpegPath)) {
        console.error(`[Job Start] CRITICAL: ffmpeg path does not exist: ${ffmpegPath}`);
        return { error: `ffmpeg directory not found at the expected path: ${ffmpegPath}` };
    }

    const payload = { jobType, url, ffmpeg_location: ffmpegPath }; 
    
    if (cookies && cookies.trim() !== '') {
        try {
            const cookieFile = path.join(os.tmpdir(), `yt-link-cookies-${Date.now()}.txt`);
            fs.writeFileSync(cookieFile, cookies, 'utf-8');
            payload.cookies_path = cookieFile; // Send path instead of raw cookies
        } catch (err) {
            dialog.showErrorBox('Cookie Error', `Failed to write cookie file: ${err.message}`);
        }
    }

    try {
        await waitForBackend();
        const fetchUrl = `http://127.0.0.1:${pyPort}/start-job`;
        console.log(`[Job Start] Sending payload to Python: ${JSON.stringify(payload)}`);
        const response = await fetch(fetchUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const responseData = await response.json();
        if (!response.ok) {
            throw new Error(responseData.error || `Python API Error (${response.status})`);
        }
        return responseData;
    } catch (error) {
        console.error(`[Job Start] Error communicating with backend:`, error);
        return { error: error.message };
    }
});

ipcMain.handle('get-job-status', async (event, jobId) => {
    if (!isBackendReady) return { status: 'failed', message: 'Backend service is not running.' };
    try {
        const response = await fetch(`http://127.0.0.1:${pyPort}/job-status?jobId=${jobId}`);
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        return await response.json();
    } catch (error) {
        return { error: error.message };
    }
});

ipcMain.handle('download-file', async (event, jobId) => {
    if (!isBackendReady) return { error: 'Backend service is not running.' };
    try {
        const statusResponse = await fetch(`http://127.0.0.1:${pyPort}/job-status?jobId=${jobId}`);
        const job = await statusResponse.json();
        if(job.status !== 'completed' || !job.file_name) {
             return { error: 'File is not ready or filename is missing.' };
        }
        
        const downloadsPath = app.getPath('downloads');
        const filePath = path.join(downloadsPath, job.file_name);
        const downloadUrl = `http://127.0.0.1:${pyPort}/download/${jobId}`;
        const downloadResponse = await fetch(downloadUrl);

        if (!downloadResponse.ok) throw new Error(`Failed to download: ${await downloadResponse.text()}`);

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
        console.error(`[Electron] Attempted to open non-existent path: ${folderPath}`);
    }
});
