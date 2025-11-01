// @ts-check
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");

/** @type {import("child_process").ChildProcessWithoutNullStreams | null} */
let pythonProcess = null;

const PYTHON_SERVICE_PORT = 5003;
// Note: PYTHON_SERVICE_URL is no longer needed here,
// as frontend/app/hooks/useApi.js and preload.js handle it.

// --- START OF NEW, ROBUST FUNCTIONS ---

/**
 * Gets the command and arguments needed to start the Python backend.
 * This function works for both dev and packaged mode.
 * @param {string} port
 * @param {string} ffmpegPath
 * @returns {{ command: string, args: string[] } | null}
 */
function getPythonBackendConfig(port, ffmpegPath) {
  const platform = process.platform;
  // This name matches your 'build:backend' script in package.json
  const execName =
    platform === "win32" ? "yt-link-backend.exe" : "yt-link-backend";

  if (app.isPackaged) {
    // --- Packaged Mode ---
    // Finds the executable in the 'backend' folder inside 'resources'
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

    // Use 'python3' on Mac/Linux and 'python' on Windows
    const pythonCommand = platform === "win32" ? "python" : "python3";
    return {
      command: pythonCommand,
      args: ["-u", scriptPath, port, ffmpegPath],
    };
  }
}

/**
 * Finds the correct path to the ffmpeg executable.
 * This function works for both dev and packaged mode.
 * @returns {string | null}
 */
function getFFmpegPath() {
  const execName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  if (app.isPackaged) {
    // --- Packaged Mode ---
    // Finds ffmpeg in the 'bin' folder inside 'resources'
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
 * Starts the Python backend service using the robust path functions.
 * @param {string} port
 */
function startPythonBackend(port) {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    console.error("[Electron] Failed to get path for ffmpeg. Aborting start.");
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
    console.log(`[Electron] Python backend process exited with code ${code}`);
    pythonProcess = null;
  });
}

// --- END OF NEW FUNCTIONS ---

// --- YOUR ORIGINAL, WORKING FUNCTIONS (UNCHANGED) ---

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // Securely link your preload script
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, // Keep this true for security
      nodeIntegration: false, // Keep this false for security
    },
  });

  if (app.isPackaged) {
    // Production: Load the static Next.js build
    const staticBuildPath = path.join(
      __dirname,
      "frontend",
      "out",
      "index.html"
    );
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
  console.log(
    "[Electron] App is ready, creating window and starting backend..."
  );
  // This order is correct
  createWindow();
  startPythonBackend(String(PYTHON_SERVICE_PORT));
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
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
    // This looks for a /Downloads/yt-link folder.
    // NOTE: Your app.py saves to a *temp* directory. This IPC handler
    // might not work as expected unless your frontend downloads the file
    // from the Flask server and saves it here.
    const downloadDir = path.join(os.homedir(), "Downloads", "yt-link");
    const jobDir = path.join(downloadDir, jobId); // This path seems unused

    // Attempt to open the main 'yt-link' download folder
    if (fs.existsSync(downloadDir)) {
      shell.openPath(downloadDir);
      return { success: true };
    } else {
      // Fallback: Just open the user's main Downloads folder
      const homeDownloads = path.join(os.homedir(), "Downloads");
      shell.openPath(homeDownloads);
      return { success: true, message: "Opened default Downloads folder." };
    }
  } catch (e) {
    console.error(`[Electron] Error opening download folder: ${e.message}`);
    // @ts-ignore
    return { success: false, error: e.message };
  }
});
