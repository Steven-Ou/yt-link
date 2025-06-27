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

    // Determine path to ffmpeg binaries
    const ffmpegPath = isDev 
        ? path.join(__dirname, 'bin')
        : path.join(process.resourcesPath, 'bin');

    if (isDev) {
        command = (process.platform === 'win32' ? 'python' : 'python3');
        const scriptPath = path.join(__dirname, 'service', 'app.py');
        // Pass the script path to the python interpreter, then the port, then the ffmpeg path.
        args = [scriptPath, port.toString(), ffmpegPath];
        spawnOptions.cwd = __dirname;
    } else {
        const exeName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
        command = path.join(process.resourcesPath, 'backend', exeName);
        // Pass the port and ffmpeg path directly to the bundled executable.
        args = [port.toString(), ffmpegPath];
        spawnOptions.cwd = path.dirname(command);
    }
    
    console.log(`[Electron] Attempting to start backend...`);
    console.log(`[Electron] Command: ${command}`);
    console.log(`[Electron] Arguments: ${JSON.stringify(args)}`);
    console.log(`[Electron] Spawn Options: ${JSON.stringify(spawnOptions)}`);
    
    if (!fs.existsSync(command)) {
        dialog.showErrorBox('Fatal Error', `Backend executable not found at path: ${command}. The application will now close.`);
        app.quit();
        return;
    }
    
    pythonProcess = spawn(command, args, spawnOptions);

    pythonProcess.stderr.on('data', (data) => {
        console.error(`[Python STDERR]: ${data}`);
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

// This is the definitive fix for the bug shown in the screenshot.
// It robustly handles cookie file creation before sending the job to the backend.
ipcMain.handle('start-job', async (event, { jobType, url, cookies }) => {
    const payload = { jobType, url }; 
    
    // ** BUG FIX START **
    // Securely handle the cookie string by writing it to a proper temporary file.
    // This prevents the ENOENT error by using the OS's designated temp directory.
    if (cookies && cookies.trim() !== '') {
        try {
            // Create a unique temporary file path
            const cookieFile = path.join(os.tmpdir(), `yt-link-cookies-${Date.now()}.txt`);
            // Write the cookies to that file
            fs.writeFileSync(cookieFile, cookies, 'utf-8');
            // Add the file path to the payload for the Python backend
            payload.cookies = cookieFile;
            console.log(`[Electron] Cookie file created successfully at: ${cookieFile}`);
        } catch (err) {
            console.error('[Electron] FATAL: Failed to write cookie file:', err);
            dialog.showErrorBox(
              'Cookie File Error',
              `Failed to write the temporary cookie file. The download will proceed without cookies, but may fail for private or age-restricted videos.\n\nError: ${err.message}`
            );
            // Do not add the cookies property to the payload if it fails
        }
    }
    // ** BUG FIX END **

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
