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
            preload: path.join(__dirname, '..', 'frontend', 'preload.js'),
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

    const startUrl = app.isPackaged ?
        `file://${path.join(__dirname, '..', 'frontend', 'out', 'index.html')}` :
        'http://localhost:3000';

    mainWindow.loadURL(startUrl);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function startPythonBackend(port) {
    const isDev = !app.isPackaged;
    let backendScriptPath;

    if (isDev) {
        backendScriptPath = path.join(__dirname, '..', 'service', 'app.py');
    } else {
        const platform = process.platform;
        const arch = process.arch;
        let exeName = 'yt-link-backend';
        if (platform === 'win32') exeName += '.exe';
        
        // Path to the backend executable in the packaged app
        backendScriptPath = path.join(path.dirname(app.getAppPath()), '..', 'service', 'dist', exeName);
    }
    
    console.log(`[Electron] Starting Python backend from: ${backendScriptPath}`);
    
    // Log file for backend stdout/stderr
    const logPath = path.join(app.getPath('userData'), 'backend.log');
    const errorLogPath = path.join(app.getPath('userData'), 'backend-error.log');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const errorLogStream = fs.createWriteStream(errorLogPath, { flags: 'a' });

    const executable = isDev ? (process.platform === 'win32' ? 'python' : 'python3') : backendScriptPath;
    const scriptArgs = isDev ? [backendScriptPath, port.toString()] : [port.toString()];

    pythonProcess = spawn(executable, scriptArgs);

    pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`[Python] ${output}`);
        logStream.write(output);
        if (output.includes(`Flask-Backend-Ready:${port}`)) {
            console.log('[Electron] Python backend has signaled it is ready.');
            isBackendReady = true;
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        const errorOutput = data.toString();
        console.error(`[Python] stderr: ${errorOutput}`);
        errorLogStream.write(errorOutput);
    });
    
    pythonProcess.on('close', (code) => {
        console.log(`[Electron] Python process exited with code ${code}`);
        pythonProcess = null;
        isBackendReady = false;
        // If the window is still open, notify the user.
        if (mainWindow) {
            mainWindow.webContents.send('backend-status', { status: 'disconnected', message: `Backend service stopped unexpectedly (code: ${code}).` });
        }
    });
}

// Unified function to proxy requests to the Python backend
async function proxyToPython(endpoint, payload) {
    try {
        await waitForBackend();
    } catch (error) {
        console.error(`[Electron] ${error.message}`);
        // This error message is now more informative and will be shown to the user.
        return { error: 'Backend service failed to start. Please try restarting the application.' };
    }

    if (!pyPort) return { error: 'Python service port not assigned.' };

    try {
        const url = `http://127.0.0.1:${pyPort}/${endpoint}`;
        console.log(`[Electron] Forwarding request to Python: ${url} with payload:`, payload);
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
        console.error(`[Electron] Error proxying to Python for endpoint ${endpoint}:`, error);
        return { error: `Communication with the backend service failed: ${error.message}` };
    }
}


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

// A single, robust handler for starting any job type.
ipcMain.handle('start-job', (event, { jobType, url, cookies }) => {
    if (!jobType || !url) {
        return { error: 'Job type and URL are required.' };
    }
    const payload = { jobType, url, cookies };
    return proxyToPython('start-job', payload);
});


ipcMain.handle('get-job-status', async (event, jobId) => {
    // No need to wait for backend here, if it's not running, we should know.
    if (!isBackendReady || !pyPort) {
        return { status: 'failed', message: 'Backend service is not running.' };
    }
    try {
        const url = `http://127.0.0.1:${pyPort}/job-status?jobId=${jobId}`;
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            // It's common for a job to 404 if it's cleaned up, handle it gracefully.
            if(response.status === 404){
                return { status: 'not_found', message: `Job ${jobId} not found.` };
            }
            throw new Error(`Python API Error: ${response.status} - ${errorText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`[Electron] Error getting job status for ${jobId}:`, error);
        return { error: error.message };
    }
});

// New handler to manage the download process from the main process
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
        
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Save MP3 File',
            defaultPath: path.join(app.getPath('downloads'), job.file_name),
            filters: [
                { name: 'Audio Files', extensions: ['mp3', 'zip'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (canceled || !filePath) {
            return { canceled: true };
        }

        const downloadUrl = `http://127.0.0.1:${pyPort}/download/${jobId}`;
        const downloadResponse = await fetch(downloadUrl);

        if (!downloadResponse.ok) {
            const errorText = await downloadResponse.text();
            throw new Error(`Failed to download file from backend: ${errorText}`);
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
    shell.openPath(folderPath).catch(err => {
        console.error(`[Electron] Failed to open folder: ${folderPath}`, err);
        dialog.showErrorBox('Error', `Could not open the folder at: ${folderPath}`);
    });
});

// Expose the downloads path to the renderer
ipcMain.handle('get-downloads-path', () => {
    return app.getPath('downloads');
});
