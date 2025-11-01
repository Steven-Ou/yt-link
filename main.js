// @ts-check
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");

/** @type {import("child_process").ChildProcessWithoutNullStreams | null} */
let pythonProcess = null;

const PYTHON_SERVICE_PORT = 5003;
const PYTHON_SERVICE_URL = `http://127.0.0.1:${PYTHON_SERVICE_PORT}`;

/**
 * @param {string} port
 * @returns {string}
 */
function getPythonScriptPath(port) {
  const serviceDir = path.join(__dirname, "service");
  if (fs.existsSync(serviceDir)) {
    // Packaged app: 'service' dir is copied
    return path.join(serviceDir, "app.py");
  }
  // Dev app: 'service' is in parent dir
  return path.join(__dirname, "..", "service", "app.py");
}

/**
 * @returns {string}
 */
function getFFmpegPath() {
  const binDir = path.join(__dirname, "bin");
  if (fs.existsSync(binDir)) {
    // Packaged app: 'bin' dir is copied
    return path.join(binDir, "ffmpeg.exe");
  }
  // Dev app: 'bin' is in parent dir
  return path.join(__dirname, "..", "bin", "ffmpeg.exe");
}

/**
 * @param {string} port
 */
function startPythonBackend(port) {
  const script = getPythonScriptPath(port);
  const ffmpegPath = getFFmpegPath();

  console.log(`[Electron] Starting backend with command: "python"`);
  console.log(`[Electron] Using arguments: [-u, ${script}, ${port}, ${ffmpegPath}]`);

  pythonProcess = spawn("python", ["-u", script, port, ffmpegPath]);

  pythonProcess.stdout.on("data", (data) => {
    const output = data.toString();
    console.log(`[Python STDOUT]: ${output.trim()}`);
    if (output.includes(`Flask-Backend-Ready:${port}`)) {
      console.log("[Electron] Backend is ready.");
      // You could send a message to the window here if needed
    }
  });

  pythonProcess.stderr.on("data", (data) => {
    console.error(`[Python STDERR]: ${data.toString().trim()}`);
  });

  pythonProcess.on("close", (code) => {
    console.log(`[Electron] Python backend process exited with code ${code}`);
    pythonProcess = null;
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // --- THIS IS THE CRITICAL FIX ---
      // Securely link your preload script
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, // Keep this true for security
      nodeIntegration: false, // Keep this false for security
    },
  });

  if (app.isPackaged) {
    // Production: Load the static Next.js build
    const staticBuildPath = path.join(__dirname, "frontend", "out", "index.html");
    console.log(`[Electron] Loading production build from: ${staticBuildPath}`);
    mainWindow.loadFile(staticBuildPath);
  } else {
    // Development: Load the Next.js dev server
    console.log("[Electron] Loading dev server from: http://localhost:3000");
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools(); // Open dev tools in dev mode
  }

  return mainWindow;
}

app.on("ready", () => {
  console.log("[Electron] App is ready, starting backend...");
  startPythonBackend(String(PYTHON_SERVICE_PORT));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("quit", () => {
  if (pythonProcess) {
    console.log("[Electron] App is quitting, killing Python backend...");
    pythonProcess.kill();
    pythonProcess = null;
  }
});

// Handle opening the download folder
ipcMain.handle("open-download-folder", (event, jobId) => {
  try {
    const downloadDir = path.join(os.homedir(), "Downloads", "yt-link");
    const jobDir = path.join(downloadDir, jobId);
    if (fs.existsSync(jobDir)) {
      shell.openPath(jobDir);
      return { success: true };
    } else if (fs.existsSync(downloadDir)) {
      shell.openPath(downloadDir);
      return { success: true };
    } else {
      console.warn(`[Electron] Download folder not found: ${jobDir} or ${downloadDir}`);
      return { success: false, error: "Download folder not found." };
    }
  } catch (e) {
    console.error(`[Electron] Error opening download folder: ${e.message}`);
    // @ts-ignore
    return { success: false, error: e.message };
  }
});
