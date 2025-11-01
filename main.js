// @ts-check
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");

/** @type {import("child_process").ChildProcessWithoutNullStreams | null} */
let pythonProcess = null;

const PYTHON_SERVICE_PORT = 5003;
// --- No longer needed, as useApi.js handles this ---
// const PYTHON_SERVICE_URL = `http://127.0.0.1:${PYTHON_SERVICE_PORT}`;

/**
 * Gets the command and arguments needed to start the Python backend.
 * @param {string} port
 * @param {string} ffmpegPath
 * @returns {{ command: string, args: string[] } | null}
 */
function getPythonBackendConfig(port, ffmpegPath) {
  const platform = process.platform;
  // This is the executable name you defined in package.json build:backend
  const execName = platform === "win32" ? "yt-link-backend.exe" : "yt-link-backend";

  if (app.isPackaged) {
    // --- Packaged Mode ---
    // Finds the executable in the 'backend' folder inside 'resources'
    // (based on your package.json extraResources config)
    const backendPath = path.join(process.resourcesPath, "backend", execName);
    if (!fs.existsSync(backendPath)) {
      console.error(
        `[Electron] ERROR: Packaged backend not found at: ${backendPath}`
      );
      return null;
    }
    console.log(`[Electron] Found packaged backend at: ${backendPath}`);
    return {
      command: backendPath,
      args: [port, ffmpegPath],
    };
  } else {
    // --- Development Mode ---
    // Finds the script in the 'service' folder in the project root
    const scriptPath = path.join(__dirname, "service", "app.py");
    if (!fs.existsSync(scriptPath)) {
      console.error(
        `[Electron] ERROR: Dev backend script not found at: ${scriptPath}`
      );
      return null;
    }
    console.log(`[Electron] Found dev backend script at: ${scriptPath}`);

    const pythonCommand = platform === "win32" ? "python" : "python3";
    return {
      command: pythonCommand,
      args: ["-u", scriptPath, port, ffmpegPath],
    };
  }
}

/**
 * @returns {string | null}
 */
function getFFmpegPath() {
  const execName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  if (app.isPackaged) {
    // --- Packaged Mode ---
    // Finds ffmpeg in the 'bin' folder inside 'resources'
    // (based on your package.json extraResources config)
    const packagedPath = path.join(process.resourcesPath, "bin", execName);
    if (fs.existsSync(packagedPath)) {
      console.log(`[Electron] Found packaged ffmpeg at: ${packagedPath}`);
      return packagedPath;
    }
    console.error(
      `[Electron] ERROR: Could not find packaged ffmpeg at: ${packagedPath}`
    );
  } else {
    // --- Development Mode ---
    // Finds ffmpeg in the 'bin' folder in the project root
    const devPath = path.join(__dirname, "bin", execName);
    if (fs.existsSync(devPath)) {
      console.log(`[Electron] Found dev ffmpeg at: ${devPath}`);
      return devPath;
    }
    console.error(`[Electron] ERROR: Could not find dev ffmpeg at: ${devPath}`);
  }

  console.error("[Electron] ERROR: Could not find ffmpeg executable.");
  return null;
}

/**
 * @param {string} port
 */
function startPythonBackend(port) {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    console.error(
      "[Electron] Failed to get path for ffmpeg. Aborting start."
    );
    return;
  }

  const backendConfig = getPythonBackendConfig(port, ffmpegPath);
  if (!backendConfig) {
    console.error(
      "[Electron] Failed to get config for backend. Aborting start."
    );
    return;
  }

  const { command, args } = backendConfig;

  console.log(`[Electron] Starting backend with command: ${command}`);
  console.log(`[Electron] Using arguments: [${args.join(", ")}]`);

  pythonProcess = spawn(command, args);

  pythonProcess.stdout.on("data", (data) => {
    const output = data.toString();
    console.log(`[Python STDOUT]: ${output.trim()}`);
    if (output.includes(`Flask-Backend-Ready:${port}`)) {
      console.log("[Electron] Backend is ready.");
    }
  });
  
  pythonProcess.stderr.on("data", (data) => {
    console.error(`[Python STDERR]: ${data.toString().trim()}`);
  });

  pythonProcess.on("close", (code) => {
    console.log(`[Electron] Python backend process exited with code ${code}.`);
    pythonProcess = null;
  });
}

function createWindow() {
  // ... identical ...
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    // ... identical ...
    const staticBuildPath = path.join(
      __dirname,
      "frontend",
      "out",
      "index.html"
    );
    // ...
    mainWindow.loadFile(staticBuildPath);
  } else {
    // ... identical ...
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}

app.on("ready", () => {
  // ... identical ...
  startPythonBackend(String(PYTHON_SERVICE_PORT));
  // ...
});

app.on("window-all-closed", () => {
  // ... identical ...
});

app.on("quit", () => {
  // ... identical ...
});

ipcMain.handle("open-download-folder", (event, jobId) => {
  // ... identical ...
});
