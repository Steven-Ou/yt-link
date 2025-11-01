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

// --- MODIFIED: This function now gets the *compiled* executable ---
/**
 * @returns {string | null}
 */
function getPythonExecutablePath() {
  let execName = "app"; // Default executable name
  if (process.platform === "win32") {
    execName = "app.exe";
  }

  // Path in packaged app
  const packagedPath = path.join(__dirname, "service", execName);
  if (fs.existsSync(packagedPath)) {
    console.log(`[Electron] Found packaged backend at: ${packagedPath}`);
    return packagedPath;
  }

  // Path in development (points to the *source* file, NOT the compiled one)
  const devPath = path.join(__dirname, "..", "service", "app.py");
  if (fs.existsSync(devPath)) {
    console.log(`[Electron] Found dev backend script at: ${devPath}`);
    return "python"; // In dev, we return "python" to be used as the command
  }

  console.error(
    "[Electron] ERROR: Could not find backend executable or script."
  );
  return null;
}

/**
 * @returns {string | null}
 */
function getFFmpegPath() {
  let execName = "ffmpeg";
  if (process.platform === "win32") {
    execName = "ffmpeg.exe";
  }

  const binDir = path.join(__dirname, "bin");
  if (fs.existsSync(path.join(binDir, execName))) {
    // Packaged app: 'bin' dir is copied
    return path.join(binDir, execName);
  }
  // Dev app: 'bin' is in parent dir
  const devBinDir = path.join(__dirname, "..", "bin");
  if (fs.existsSync(path.join(devBinDir, execName))) {
    return path.join(devBinDir, execName);
  }

  console.error("[Electron] ERROR: Could not find ffmpeg executable.");
  return null;
}

/**
 * @param {string} port
 */
function startPythonBackend(port) {
  const command = getPythonExecutablePath();
  const ffmpegPath = getFFmpegPath();

  if (!command || !ffmpegPath) {
    console.error(
      "[Electron] Failed to get paths for backend or ffmpeg. Aborting start."
    );
    return;
  }

  let args = [];
  let finalCommand = command;

  if (command === "python") {
    // --- Development Mode ---

    // --- FIX: Use 'python3' on Mac/Linux and 'python' on Windows ---
    finalCommand = process.platform === "win32" ? "python" : "python3";
    // --- END FIX ---

    const scriptPath = path.join(__dirname, "..", "service", "app.py");
    args = ["-u", scriptPath, port, ffmpegPath];
    // --- FIX: Update log message to show the correct command ---
    console.log(
      `[Electron] Starting dev backend with command: "${finalCommand}"`
    );
  } else {
    // --- Packaged Mode ---
    // 'command' is the full path to the compiled executable
    finalCommand = command;
    args = [port, ffmpegPath];
    console.log(
      `[Electron] Starting packaged backend with command: ${finalCommand}`
    );
  }

  console.log(`[Electron] Using arguments: [${args.join(", ")}]`);

  pythonProcess = spawn(finalCommand, args);

  pythonProcess.stdout.on("data", (data) => {
    const output = data.toString();
    console.log(`[Python STDOUT]: ${output.trim()}`);
    if (output.includes(`Flask-Backend-Ready:${port}`)) {
      console.log("[Electron] Backend is ready.");
    }
  });
  // ... rest of the file is identical to the one I sent before ...
  pythonProcess.stderr.on("data", (data) => {
    // ...
  });
  pythonProcess.on("close", (code) => {
    // ...
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
