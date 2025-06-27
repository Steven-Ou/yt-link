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
            dialog.showErrorBox('Startup Error', 'Could not find a free port for the backend service.');
            app.quit();
        });

    if (app.isPackaged) {
        mainWindow.loadFile(path.join(__dirname, 'frontend', 'out', 'index.html'));
    } else {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    }
}

function startPythonBackend(port) {
    const isDev = !app.isPackaged;
    const ffmpegPath = isDev 
        ? path.join(__dirname, 'bin')
        : path.join(process.resourcesPath, 'bin');

    const command = isDev 
        ? (process.platform === 'win32' ? 'python' : 'python3') 
        : path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend');

    const args = isDev 
        ? [path.join(__dirname, 'service', 'app.py'), port.toString(), ffmpegPath]
        : [port.toString(), ffmpegPath];
    
    // **LOGGING FIX**: Forward Python's output to the frontend renderer.
    pythonProcess = spawn(command, args);

    const forwardLog = (log) => {
        console.log(log); // Also log to the main process terminal.
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('backend-log', log);
        }
    };
    
    pythonProcess.stdout.on('data', (data) => {
        const log = `[Python STDOUT]: ${data.toString().trim()}`;
        forwardLog(log);
        if (data.toString().includes(`Flask-Backend-Ready:${port}`)) {
            isBackendReady = true;
        }
    });
    
    pythonProcess.stderr.on('data', (data) => {
        forwardLog(`[Python STDERR]: ${data.toString().trim()}`);
    });
    
    pythonProcess.on('close', (code) => {
        forwardLog(`[Electron] Python process exited with code ${code}`);
    });
}

app.on('ready', createWindow);
app.on('window-all-closed', () => app.quit());
app.on('quit', () => pythonProcess?.kill());

ipcMain.handle('start-job', async (event, payload) => {
    if (!isBackendReady) return { error: 'Backend is not ready.' };
    try {
        const response = await fetch(`http://127.0.0.1:${pyPort}/start-job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return await response.json();
    } catch (error) {
        return { error: error.message };
    }
});

// Other IPC handlers (get-job-status, download-file, etc.) remain the same
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
