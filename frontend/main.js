const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const portfinder = require('portfinder');
const fetch = require('node-fetch'); // Required for communication with the Python backend

let mainWindow;
let pythonProcess;
let pythonPort;

// --- Function to Create the Main Application Window ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
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
  // --- Register ALL IPC handlers here ---
  // This centralizes communication between the frontend and the Python backend.

  // Handler for selecting a download directory
  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (!result.canceled) {
      return result.filePaths[0];
    }
    return null;
  });
  
  // Generic function to forward job requests to the Python backend
  const startJob = async (endpoint, data) => {
      if (!pythonPort) throw new Error('Python backend is not available.');
      try {
          const response = await fetch(`http://localhost:${pythonPort}/${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
          });
          if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Python API Error: ${response.statusText} - ${errorText}`);
          }
          return await response.json(); // Should return { job_id: '...' }
      } catch (error) {
          console.error(`Failed to start job via ${endpoint}:`, error);
          throw error;
      }
  };

  // Handler for single MP3 downloads
  ipcMain.handle('start-single-mp3-job', (event, data) => {
    return startJob('start-single-mp3-job', data);
  });

  // Handler for playlist downloads (zipped)
  ipcMain.handle('start-playlist-zip-job', (event, data) => {
    return startJob('start-playlist-zip-job', data);
  });

  // Handler for playlist downloads (combined into one MP3)
  ipcMain.handle('start-combine-playlist-mp3-job', (event, data) => {
    return startJob('start-combine-playlist-mp3-job', data);
  });
  
  // Handler for checking the status of any job
  ipcMain.handle('get-job-status', async (event, jobId) => {
    if (!pythonPort) throw new Error('Python backend is not available.');
    try {
      const response = await fetch(`http://localhost:${pythonPort}/job-status/${jobId}`);
      if (!response.ok) {
        const errorText = await response.text();
        // A 404 is expected if the job ID isn't found yet, don't throw an error for that.
        if (response.status === 404) return { status: 'not_found' };
        throw new Error(`Python API Error: ${response.statusText} - ${errorText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Failed to get job status for ${jobId}:`, error);
      throw error;
    }
  });


  // --- Start Backend and Create Window ---
  await startPythonBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (pythonProcess) {
    console.log('Terminating Python backend process.');
    pythonProcess.kill();
  }
});
