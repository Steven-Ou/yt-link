const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const findFreePort = require('find-free-port');
const fetch = require('node-fetch');
const fs = require('fs');

let pythonProcess = null;
let mainWindow = null;

// This variable will hold the dynamically assigned port for the Python service.
let pyPort = null;

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

    // Start the Python backend service
    findFreePort(5001) // Start searching for a free port from 5001
        .then(freePort => {
            pyPort = freePort; // Store the found port in our global variable
            console.log(`Found free port for Python service: ${pyPort}`);

            // Determine the path to the executable based on the environment
            const isDev = process.env.NODE_ENV !== 'production';
            const serviceName = process.platform === 'win32' ? 'app.exe' : 'app';
            // In dev, we might run the script directly. In prod, we run the bundled executable.
            const pyServicePath = isDev
                ? path.join(__dirname, '../../service/app.py') // Path for development
                : path.join(process.resourcesPath, 'service', serviceName); // Path for packaged app

            console.log(`Attempting to start Python service at: ${pyServicePath}`);
            
            if (!fs.existsSync(pyServicePath)) {
                console.error('Python service executable not found at path:', pyServicePath);
                dialog.showErrorBox('Backend Error', 'The backend service executable could not be found.');
                app.quit();
                return;
            }

            // Spawn the Python process, passing the found port as an argument
            pythonProcess = spawn(pyServicePath, [pyPort.toString()]);

            pythonProcess.stdout.on('data', (data) => {
                console.log(`Python stdout: ${data}`);
            });
            pythonProcess.stderr.on('data', (data) => {
                console.error(`Python stderr: ${data}`);
            });
            pythonProcess.on('close', (code) => {
                console.log(`Python process exited with code ${code}`);
            });
        })
        .catch(err => {
            console.error('Could not find a free port:', err);
            dialog.showErrorBox('Backend Error', 'Could not find a free port to start the backend service.');
            app.quit();
        });

    // Load the Next.js app
    const startUrl = 'http://localhost:3000';
    mainWindow.loadURL(startUrl);

    // Open the DevTools.
    // mainWindow.webContents.openDevTools();

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
    // Kill the python process when the app quits
    if (pythonProcess) {
        console.log('Terminating Python process...');
        pythonProcess.kill();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// --- IPC Handlers ---

// A generic function to start a job
async function startJob(jobType, payload) {
    if (!pyPort) { // Check if the Python service port is available
        return { error: 'Python service is not ready.' };
    }
    try {
        // FIX: Use the dynamic `pyPort` variable instead of the hardcoded port 8000
        const response = await fetch(`http://127.0.0.1:${pyPort}/${jobType}`, {
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
        console.error(`Error invoking remote method '${jobType}':`, error);
        return { error: error.message };
    }
}

// IPC handler for starting a single MP3 download job
ipcMain.handle('start-single-mp3-job', async (event, payload) => {
    return await startJob('start-single-mp3-job', payload);
});

// IPC handler for starting a playlist ZIP download job
ipcMain.handle('start-playlist-zip-job', async (event, payload) => {
    return await startJob('start-playlist-zip-job', payload);
});

// IPC handler for starting a combined playlist MP3 download job
ipcMain.handle('start-combine-playlist-mp3-job', async (event, payload) => {
    return await startJob('start-combine-playlist-mp3-job', payload);
});

// IPC handler for checking job status
ipcMain.handle('get-job-status', async (event, jobId) => {
    if (!pyPort) { // Check if the Python service port is available
        return { error: 'Python service is not ready.' };
    }
    try {
        // FIX: Use the dynamic `pyPort` variable here as well
        const response = await fetch(`http://127.0.0.1:${pyPort}/job-status?jobId=${jobId}`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Python API Error: ${response.status} - ${errorText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Error getting job status for ${jobId}:`, error);
        return { error: error.message };
    }
});

// IPC handler to open a directory selection dialog
ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    if (result.canceled) {
        return null;
    } else {
        return result.filePaths[0];
    }
});

// IPC handler to get the default downloads path
const { shell } = require('electron');
ipcMain.handle('open-folder', async (event, folderPath) => {
    try {
        await shell.openPath(folderPath);
        return { success: true };
    } catch (error) {
        console.error(`Failed to open folder: ${folderPath}`, error);
        return { error: error.message };
    }
});
