const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const portfinder = require('portfinder');
const fetch = require('node-fetch');
const fs = require('fs');

let pythonProcess = null;
let mainWindow = null;
let pyPort = null; // This will hold the dynamically assigned port
let isBackendReady = false; // This flag will track if the Python service is ready

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    portfinder.getPortPromise({ port: 5001 })
        .then(freePort => {
            pyPort = freePort;
            console.log(`[Electron] Found free port for Python service: ${pyPort}`);

            const isDev = !app.isPackaged;
            const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
            
            const pyServicePath = isDev
                ? path.join(app.getAppPath(), 'service/dist', backendExecutableName)
                : path.join(process.resourcesPath, 'backend', backendExecutableName);

            console.log(`[Electron] Attempting to start Python service at: ${pyServicePath}`);
            
            if (!fs.existsSync(pyServicePath)) {
                console.error('[Electron] Python service executable not found at path:', pyServicePath);
                dialog.showErrorBox('Backend Error', `The backend service executable could not be found at: ${pyServicePath}`);
                app.quit();
                return;
            }

            pythonProcess = spawn(pyServicePath, [pyPort.toString()]);

            // FIX: Listen to the Python process's stdout to know when it's ready.
            pythonProcess.stdout.on('data', (data) => {
                const output = data.toString();
                console.log(`[Python] stdout: ${output}`);
                // Check for the specific "ready" message from the Python script.
                if (output.includes('Flask-Backend-Ready')) {
                    console.log('[Electron] Python backend has signaled it is ready.');
                    isBackendReady = true;
                }
            });

            pythonProcess.stderr.on('data', (data) => {
                console.error(`[Python] stderr: ${data}`);
            });
            pythonProcess.on('close', (code) => {
                console.log(`[Python] process exited with code ${code}`);
                isBackendReady = false; // Mark backend as not ready if it closes
            });
        })
        .catch(err => {
            console.error('[Electron] Could not find a free port:', err);
            dialog.showErrorBox('Backend Error', 'Could not find a free port to start the backend service.');
            app.quit();
        });

    const startUrl = app.isPackaged 
        ? `file://${path.join(__dirname, 'out/index.html')}`
        : 'http://localhost:3000';
        
    mainWindow.loadURL(startUrl);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('quit', () => {
    if (pythonProcess) {
        console.log('[Electron] Terminating Python process...');
        pythonProcess.kill();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// --- IPC Handlers ---

// This generic handler proxies requests to the Python backend on the correct port.
async function proxyToPython(endpoint, payload) {
    // FIX: Check if the backend is ready before attempting to send a request.
    if (!isBackendReady) {
        console.error('[Electron] Attempted to call backend before it was ready.');
        return { error: 'Backend service is still starting up. Please try again in a moment.' };
    }
    if (!pyPort) {
        return { error: 'Python service port not assigned.' };
    }
    try {
        const url = `http://127.0.0.1:${pyPort}/${endpoint}`;
        console.log(`[Electron] Forwarding request to Python: ${url}`);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Python API Error: ${response.status} - ${errorText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`[Electron] Error invoking remote method '${endpoint}':`, error);
        return { error: error.message };
    }
}

ipcMain.handle('start-single-mp3-job', (event, payload) => proxyToPython('start-single-mp3-job', payload));
ipcMain.handle('start-playlist-zip-job', (event, payload) => proxyToPython('start-playlist-zip-job', payload));
ipcMain.handle('start-combine-playlist-mp3-job', (event, payload) => proxyToPython('start-combine-playlist-mp3-job', payload));

ipcMain.handle('get-job-status', async (event, jobId) => {
    if (!isBackendReady) {
        return { error: 'Backend service is not ready.' };
    }
    if (!pyPort) {
        return { error: 'Python service port not assigned.' };
    }
    try {
        const url = `http://127.0.0.1:${pyPort}/job-status?jobId=${jobId}`;
        console.log(`[Electron] Checking job status: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Python API Error: ${response.status} - ${errorText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`[Electron] Error getting job status for ${jobId}:`, error);
        return { error: error.message };
    }
});

ipcMain.handle('select-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return canceled ? null : filePaths[0];
});

ipcMain.handle('open-folder', (event, folderPath) => shell.openPath(folderPath));
