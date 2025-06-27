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

// Promise to ensure the backend is ready before proceeding
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
                const errorMsg = `The Python backend service failed to start. This is a critical error.\n\nPlease check the debug log file for details:\n${logPath}`;
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
            console.log(`[Electron] Found free port for Python service: ${pyPort}`);
            startPythonBackend(pyPort);
        })
        .catch(err => {
            console.error('[Electron] Could not find a free port for the backend.', err);
            dialog.showErrorBox('Startup Error', 'Could not find a free port to start the backend service.');
            app.quit();
        });

    if (app.isPackaged) {
        const filePath = path.join(__dirname, 'frontend', 'out', 'index.html');
        console.log(`[Electron] Loading packaged frontend from: ${filePath}`);
        mainWindow.loadFile(filePath);
    } else {
        const url = 'http://localhost:3000';
        console.log(`[Electron] Loading dev frontend from: ${url}`);
        mainWindow.loadURL(url);
        mainWindow.webContents.openDevTools(); // Open dev tools automatically in dev mode
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

    // --- FFMPEG PATH DEBUGGING START ---
    console.log(`[FFMPEG Debug] Is App Packaged? ${!isDev}`);
    const devFfmpegPath = path.join(__dirname, 'bin');
    const prodFfmpegPath = path.join(process.resourcesPath, 'bin');

    const ffmpegPath = isDev ? devFfmpegPath : prodFfmpegPath;

    console.log(`[FFMPEG Debug] Final ffmpeg path to be used: ${ffmpegPath}`);
    // Check if the directory and files actually exist at the determined path
    if (fs.existsSync(ffmpegPath)) {
        console.log(`[FFMPEG Debug] SUCCESS: The ffmpeg directory exists at: ${ffmpegPath}`);
        const ffmpegExe = path.join(ffmpegPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
        const ffprobeExe = path.join(ffmpegPath, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
        console.log(`[FFMPEG Debug] Checking for ffmpeg executable at: ${ffmpegExe}`);
        console.log(`[FFMPEG Debug] Exists? ${fs.existsSync(ffmpegExe)}`);
        console.log(`[FFMPEG Debug] Checking for ffprobe executable at: ${ffprobeExe}`);
        console.log(`[FFMPEG Debug] Exists? ${fs.existsSync(ffprobeExe)}`);
    } else {
        console.error(`[FFMPEG Debug] ERROR: The ffmpeg directory does NOT exist at: ${ffmpegPath}`);
    }
    // --- FFMPEG PATH DEBUGGING END ---


    if (isDev) {
        command = (process.platform === 'win32' ? 'python' : 'python3');
        const scriptPath = path.join(__dirname, 'service', 'app.py');
        args = [scriptPath, port.toString(), ffmpegPath];
        spawnOptions.cwd = __dirname;
    } else {
        const exeName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
        command = path.join(process.resourcesPath, 'backend', exeName);
        args = [port.toString(), ffmpegPath];
        spawnOptions.cwd = path.dirname(command);
    }
    
    console.log(`[Electron] Attempting to start backend...`);
    console.log(`[Electron] Command: ${command}`);
    console.log(`[Electron] Arguments: ${JSON.stringify(args)}`);
    
    if (!fs.existsSync(command)) {
        dialog.showErrorBox('Fatal Error', `Backend executable not found at path: ${command}. The application will now close.`);
        app.quit();
        return;
    }
    
    pythonProcess = spawn(command, args, spawnOptions);

    pythonProcess.stderr.on('data', (data) => {
        console.error(`[Python STDERR]: ${data.toString()}`);
    });

    pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`[Python STDOUT]: ${output}`);
        if (output.includes(`Flask-Backend-Ready:${port}`)) {
            console.log('[Electron] Python backend has signaled it is ready.');
            isBackendReady = true;
        }
    });
    
    pythonProcess.on('close', (code) => {
        console.log(`[Electron] Python process exited with code ${code}`);
        pythonProcess = null;
        isBackendReady = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
             dialog.showErrorBox('Backend Error', `The backend service stopped unexpectedly (code: ${code}). Please restart the application.`);
        }
    });
}


// --- App Lifecycle Events ---
app.on('ready', createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

app.on('quit', () => {
    if (pythonProcess) {
        console.log('[Electron] Terminating Python backend process.');
        pythonProcess.kill();
    }
});

// --- IPC Handlers ---
ipcMain.handle('start-job', async (event, { jobType, url, cookies }) => {
    const payload = { jobType, url }; 
    
    if (cookies && cookies.trim() !== '') {
        try {
            const cookieFile = path.join(os.tmpdir(), `yt-link-cookies-${Date.now()}.txt`);
            fs.writeFileSync(cookieFile, cookies, 'utf-8');
            payload.cookies = cookieFile;
            console.log(`[Electron] Cookie file created successfully at: ${cookieFile}`);
        } catch (err) {
            console.error('[Electron] FATAL: Failed to write cookie file:', err);
            dialog.showErrorBox(
              'Cookie File Error',
              `Failed to write the temporary cookie file.\n\nError: ${err.message}`
            );
        }
    }

    try {
        await waitForBackend();
        const fetchUrl = `http://127.0.0.1:${pyPort}/start-job`;
        const response = await fetch(fetchUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Python API Error (${response.status}): ${errorText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`[Electron] Error communicating with backend:`, error);
        return { error: `Communication with the backend service failed: ${error.message}` };
    }
});


ipcMain.handle('get-job-status', async (event, jobId) => {
    if (!isBackendReady) return { status: 'failed', message: 'Backend service is not running.' };
    try {
        const url = `http://127.0.0.1:${pyPort}/job-status?jobId=${jobId}`;
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) return { status: 'not_found', message: `Job ${jobId} not found.` };
            throw new Error(`Python API Error: ${response.status} - ${await response.text()}`);
        }
        return await response.json();
    } catch (error) {
        return { error: error.message };
    }
});

ipcMain.handle('download-file', async (event, jobId) => {
    if (!isBackendReady) return { error: 'Backend service is not running.' };
    try {
        const jobStatusUrl = `http://127.0.0.1:${pyPort}/job-status?jobId=${jobId}`;
        const statusResponse = await fetch(jobStatusUrl);
        if(!statusResponse.ok) throw new Error('Could not get job status before download.');
        
        const job = await statusResponse.json();
        if(job.status !== 'completed' || !job.file_name) {
             return { error: 'File is not ready for download or filename is missing.' };
        }
        
        const downloadsPath = app.getPath('downloads');
        const filePath = path.join(downloadsPath, job.file_name);
        
        const downloadUrl = `http://127.0.0.1:${pyPort}/download/${jobId}`;
        const downloadResponse = await fetch(downloadUrl);

        if (!downloadResponse.ok) {
            throw new Error(`Failed to download file from backend: ${await downloadResponse.text()}`);
        }

        const fileStream = fs.createWriteStream(filePath);
        await new Promise((resolve, reject) => {
            downloadResponse.body.pipe(fileStream);
            downloadResponse.body.on("error", reject);
            fileStream.on("finish", resolve);
        });

        return { success: true, path: filePath };

    } catch(error) {
        dialog.showErrorBox('Download Error', `Could not download the file. Reason: ${error.message}`);
        return { error: error.message };
    }
});

ipcMain.handle('open-folder', (event, folderPath) => {
    if (folderPath && fs.existsSync(folderPath)) {
        shell.showItemInFolder(folderPath);
    } else {
        console.error(`[Electron] Attempted to open a path that does not exist: ${folderPath}`);
    }
});
