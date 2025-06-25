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
function waitForBackend(timeout = 15000) { // Increased timeout for slower machines
    return new Promise((resolve, reject) => {
        if (isBackendReady) return resolve(true);

        const startTime = Date.now();
        const interval = setInterval(() => {
            if (isBackendReady) {
                clearInterval(interval);
                resolve(true);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                // Try to provide more info on why it might have failed
                const errorLogPath = path.join(app.getPath('userData'), 'backend-error.log');
                let errorDetails = `Check the log for details: ${errorLogPath}`;
                if (pythonProcess && pythonProcess.exitCode !== null) {
                    errorDetails = `Python process exited with code ${pythonProcess.exitCode}.`;
                }
                reject(new Error(`Backend service failed to start in time. ${errorDetails}`));
            }
        }, 250);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            // FIX: Correctly reference the preload script's location relative to this file
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

    // FIX: The path to the frontend is relative to the main.js file.
    const startUrl = app.isPackaged ?
        `file://${path.join(__dirname, '..', 'out', 'index.html')}` :
        'http://localhost:3000';
    
    console.log(`[Electron] Loading frontend from: ${startUrl}`);
    mainWindow.loadURL(startUrl);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function startPythonBackend(port) {
    const isDev = !app.isPackaged;
    let backendExecutablePath;

    // Determine the path to the backend executable
    if (isDev) {
        // In development, we run the python script directly.
        backendExecutablePath = path.join(__dirname, '..', '..', 'service', 'app.py');
    } else {
        // In production, the executable is packaged.
        const exeName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
        // 'process.resourcesPath' is the reliable way to get the resources directory in a packaged app.
        // This assumes your packager puts the backend executable in 'resources/service/dist'.
        backendExecutablePath = path.join(process.resourcesPath, 'service', 'dist', exeName);
    }
    
    // --- Enhanced Logging & Debugging ---
    console.log(`[Electron] Attempting to start backend from: ${backendExecutablePath}`);
    
    // Check if the file actually exists before trying to spawn it.
    if (!fs.existsSync(backendExecutablePath)) {
        const errorMsg = `Backend executable not found at path: ${backendExecutablePath}. This is a packaging error. Ensure the backend is built and included in the 'extraResources' of your electron-builder config.`;
        console.error(`[Electron] FATAL: ${errorMsg}`);
        dialog.showErrorBox('Fatal Error', errorMsg);
        app.quit();
        return;
    }
    // --- End Enhanced Logging ---

    const logPath = path.join(app.getPath('userData'), 'backend.log');
    const errorLogPath = path.join(app.getPath('userData'), 'backend-error.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const errorLogStream = fs.createWriteStream(errorLogPath, { flags: 'a' });

    // In dev, the command is 'python', in prod, it's the executable itself.
    const command = isDev ? (process.platform === 'win32' ? 'python' : 'python3') : backendExecutablePath;
    const args = isDev ? [backendExecutablePath, port.toString()] : [port.toString()];
    
    console.log(`[Electron] Spawning command: '${command}' with args: [${args.join(', ')}]`);

    pythonProcess = spawn(command, args);

    pythonProcess.on('error', (err) => {
        // This will catch errors like EPERM or other OS-level spawn errors.
        console.error(`[Electron] Failed to start Python process. Error: ${err.message}`);
        dialog.showErrorBox('Backend Error', `Failed to start the backend process: ${err.message}`);
    });

    pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`[Python STDOUT] ${output}`);
        logStream.write(output);
        if (output.includes(`Flask-Backend-Ready:${port}`)) {
            console.log('[Electron] Python backend has signaled it is ready.');
            isBackendReady = true;
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        const errorOutput = data.toString();
        console.error(`[Python STDERR] ${errorOutput}`);
        errorLogStream.write(errorOutput);
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

// --- IPC Handlers (No changes needed here from previous version) ---
// This assumes you are using the unified 'start-job' and 'download-file' handlers

// A single, robust handler for starting any job type.
ipcMain.handle('start-job', async (event, { jobType, url, cookies }) => {
    if (!jobType || !url) {
        return { error: 'Job type and URL are required.' };
    }
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
        console.error(`[Electron] Error starting job:`, error);
        return { error: `Communication with the backend service failed: ${error.message}` };
    }
});


ipcMain.handle('get-job-status', async (event, jobId) => {
    if (!isBackendReady || !pyPort) {
        return { status: 'failed', message: 'Backend service is not running.' };
    }
    try {
        const url = `http://127.0.0.1:${pyPort}/job-status?jobId=${jobId}`;
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) {
                return { status: 'not_found', message: `Job ${jobId} not found.` };
            }
            const errorText = await response.text();
            throw new Error(`Python API Error: ${response.status} - ${errorText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`[Electron] Error getting job status for ${jobId}:`, error);
        return { error: error.message };
    }
});

ipcMain.handle('download-file', async (event, jobId) => {
    if (!isBackendReady || !pyPort) {
        return { error: 'Backend service is not running.' };
    }
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
        console.error(`[Electron] Failed to download file for job ${jobId}:`, error);
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

ipcMain.handle('get-downloads-path', () => {
    return app.getPath('downloads');
});
