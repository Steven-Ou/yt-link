const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const portfinder = require('portfinder');
const fetch = require('node-fetch');
const fs = require('fs');
const os = require('os'); // Required for handling temporary files

let pythonProcess = null;
let mainWindow = null;
let pyPort = null;
let isBackendReady = false;

// Helper function to wait for the backend to be ready
function waitForBackend(timeout = 10000) { // Increased timeout to 10 seconds for safety
    return new Promise((resolve, reject) => {
        if (isBackendReady) return resolve(true);
        const startTime = Date.now();
        const interval = setInterval(() => {
            if (isBackendReady) {
                clearInterval(interval);
                resolve(true);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                reject(new Error('Backend service failed to start in time.'));
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
                return app.quit();
            }
            pythonProcess = spawn(pyServicePath, [pyPort.toString()]);
            pythonProcess.stdout.on('data', (data) => {
                const output = data.toString();
                console.log(`[Python] stdout: ${output}`);
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
                isBackendReady = false;
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
    mainWindow.on('closed', () => { mainWindow = null; });
}

app.on('ready', createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('quit', () => { if (pythonProcess) pythonProcess.kill(); });
app.on('activate', () => { if (mainWindow === null) createWindow(); });

// --- IPC Handlers ---

// FIX: This is the core of the solution. It saves the cookie string to a temp file.
function handleCookiePayload(payload) {
    if (payload.cookiesPath && payload.cookiesPath.trim().length > 0) {
        try {
            // Create a temporary file path
            const tempDir = app.getPath('temp');
            const cookieFilePath = path.join(tempDir, `yt-link-cookies-${Date.now()}.txt`);
            // Write the cookie string to the file
            fs.writeFileSync(cookieFilePath, payload.cookiesPath);
            console.log(`[Electron] Saved cookies to temporary file: ${cookieFilePath}`);
            // Update the payload to use the file path instead of the raw string
            payload.cookiesPath = cookieFilePath;
        } catch (error) {
            console.error('[Electron] Failed to write temporary cookie file:', error);
            // If it fails, nullify the path so it doesn't cause a crash
            payload.cookiesPath = null;
        }
    } else {
        payload.cookiesPath = null;
    }
    return payload;
}

async function proxyToPython(endpoint, payload) {
    try {
        await waitForBackend();
    } catch (error) {
        console.error(`[Electron] ${error.message}`);
        return { error: 'Backend service failed to start. Please try restarting the application.' };
    }
    if (!pyPort) return { error: 'Python service port not assigned.' };

    // Handle the cookie data before sending the payload to Python
    const finalPayload = handleCookiePayload(payload);

    try {
        const url = `http://127.0.0.1:${pyPort}/${endpoint}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalPayload),
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
    try {
        await waitForBackend();
    } catch (error) {
        console.error(`[Electron] ${error.message}`);
        return { error: 'Backend service failed to start. Please try restarting the application.' };
    }
    if (!pyPort) return { error: 'Python service port not assigned.' };
    try {
        const url = `http://127.0.0.1:${pyPort}/job-status?jobId=${jobId}`;
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
