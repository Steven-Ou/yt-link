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
                const errorMsg = `The Python backend service failed to start. This is a critical error.

Please check the debug log file for details:
${logPath}`;
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
            // With main.js in the root, the path to preload.js is direct.
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
        // With main.js in the root of the packaged app, we go into the 'frontend/out' dir.
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
    let backendExecutablePath;
    let spawnOptions = {};

    if (isDev) {
        // In dev, run the python script from the root of the project.
        backendExecutablePath = path.join(__dirname, 'service', 'app.py');
        spawnOptions.cwd = __dirname; // Set cwd to project root in dev
    } else {
        // In production, the executable is packaged inside the 'resources' folder.
        const exeName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
        backendExecutablePath = path.join(process.resourcesPath, 'backend', exeName);
        // Set the cwd for the python process to its own directory.
        spawnOptions.cwd = path.dirname(backendExecutablePath);
    }
    
    console.log(`[Electron] Attempting to start backend from: ${backendExecutablePath}`);
    console.log(`[Electron] Setting spawn CWD to: ${spawnOptions.cwd}`);
    
    if (!fs.existsSync(backendExecutablePath)) {
        const errorMsg = `Backend executable not found at path: ${backendExecutablePath}. This is a packaging error.`;
        dialog.showErrorBox('Fatal Error', errorMsg);
        app.quit();
        return;
    }

    const command = isDev ? (process.platform === 'win32' ? 'python' : 'python3') : backendExecutablePath;
    const args = isDev ? [backendExecutablePath, port.toString()] : [port.toString()];
    
    console.log(`[Electron] Spawning command: '${command}' with args: [${args.join(', ')}]`);

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
        if (mainWindow) {
            mainWindow.webContents.send('backend-status', { status: 'disconnected', message: `Backend service stopped unexpectedly (code: ${code}).` });
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
    const payload = { jobType, url, cookies };
    try {
        await waitForBackend();
        const url = `http://127.0.0.1:${pyPort}/start-job`;
        const response = await fetch(url, {
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
    if (folderPath && path.extname(folderPath) !== '') {
        shell.showItemInFolder(folderPath);
    } else if (folderPath) {
        shell.openPath(folderPath).catch(err => {
            console.error(`[Electron] Failed to open folder: ${folderPath}`, err);
        });
    }
});
