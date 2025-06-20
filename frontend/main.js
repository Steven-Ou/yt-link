const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron'); // Add 'shell'
const path = require('path');
const { spawn } = require('child_process');
const portfinder = require('portfinder');
const fetch = require('node-fetch');

let mainWindow;
let pythonProcess;
let pythonPort;

// --- Function to Create the Main Application Window ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true, 
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  
  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'out/index.html'));
  }
}

// --- Function to Start the Python Backend Server ---
const startPythonBackend = async () => {
  pythonPort = await portfinder.getPortPromise();
  
  const isDev = !app.isPackaged;

  const backendExecutableName = process.platform === 'win32' ? 'yt-link-backend.exe' : 'yt-link-backend';
  
  const backendPath = isDev
    ? path.join(__dirname, '../../service/app.py')
    : path.join(process.resourcesPath, 'backend', backendExecutableName);

  const command = isDev ? 'python' : backendPath;
  const args = [pythonPort.toString()];
  
  console.log(`Starting backend with command: "${command}" and args: [${args.join(', ')}]`);

  pythonProcess = isDev ? spawn(command, [backendPath, ...args]) : spawn(command, args);

  pythonProcess.stdout.on('data', (data) => {
    console.log(`Python stdout: ${data}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python stderr: ${data}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`);
  });
};


// --- Electron App Lifecycle & IPC Handlers ---
app.whenReady().then(async () => {
  // Handler for selecting a download directory
  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  
  // Generic function to forward job requests to the Python backend
  const startJob = async (endpoint, data) => {
      if (!pythonPort) throw new Error('Python backend is not available.');
      const response = await fetch(`http://127.0.0.1:${pythonPort}/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
      });
      if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Python API Error: ${response.statusText} - ${errorText}`);
      }
      return await response.json();
  };

  ipcMain.handle('start-single-mp3-job', (event, data) => startJob('start-single-mp3-job', data));
  ipcMain.handle('start-playlist-zip-job', (event, data) => startJob('start-playlist-zip-job', data));
  ipcMain.handle('start-combine-playlist-mp3-job', (event, data) => startJob('start-combine-playlist-mp3-job', data));
  
  // Handler for checking the status of any job
  ipcMain.handle('get-job-status', async (event, jobId) => {
    if (!pythonPort) throw new Error('Python backend is not available.');
    const response = await fetch(`http://127.0.0.1:${pythonPort}/job-status/${jobId}`);
    return await response.json();
  });

  // ADDED: Handler for opening a folder in the file explorer
  ipcMain.handle('open-folder', (event, folderPath) => {
    shell.openPath(folderPath);
  });

  await startPythonBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (pythonProcess) {
    console.log('Terminating Python backend process.');
    pythonProcess.kill();
  }
});
