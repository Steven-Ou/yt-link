//main.js
const { app, BrowserWindow} = require('electron'); // Importing app and BrowserWindow from electron
const path = require('path'); // Importing path module
const{spawn} = require('child_process'); // Importing spawn from child_process module
const isDev = require('electron-is-dev'); // Importing electron-is-dev module
const tcpPortUsed = require('tcp-port-used'); // Importing tcp-port-used module
const{autoUpdater} = require('electron-updater'); // Importing autoUpdater from electron-updater module
const log = require('electron-log'); // Importing electron-log module

const FLASK_PORT = 8080; // Port for Flask server
const FLASK_HOST = '127.0.0.1'; // Host for Flask server
const NEXTJS_DEV_URL ='http://localhost:3000'; // URL for Next.js development server
const flaskAppDirectory = path.join(__dirname, '..', 'service') // Directory for Flask app
const flaskAppScript = "app.py"; // Flask app script name

const pythonInterpreterPath = path.join(flaskAppDirectory, 'venv', 'bin', 'python'); // Path to Python interpreter in virtual environment
// Windows example (uncomment and adjust if needed):
// const pythonInterpreterPath = path.join(flaskAppDirectory, 'venv', 'Scripts', 'python.exe');

let mainWindow; // Variable to hold the main window instance
let flaskProcess = null; // Variable to hold the Flask process instance

// --- Auto Updater Logging  ---
autoUpdater.logger =log; // Set the logger for autoUpdater
autoUpdater.logger.transports.file.level = 'info'; // Set the log level to info
log.info('App starting...'); // Log the app starting message

// Disable auto-download: USER WILL BE THE ONE CONSENTING TO DOWNLOAD
autoUpdater.autoDownload = false; // Disable auto-download for updates

//--- Flask Server Mangement --- 
function startFlaskServer() {
    log.info('Starting Flask Server...'); // Log the message indicating Flask server is starting
    log.info(`Using Python interpreter at: ${pythonInterpreterPath}`); // Log the path to the Python interpreter
    log.info(`Flask app script: ${path.join(flaskAppDirectory,flaskAppScript)}`); // Log the path to the Flask app script
    log.info(`Flask working directory: ${flaskAppDirectory}`); // Log the working directory for Flask app

    try{
        console.log(`Waiting for Flask server on port ${FLASK_PORT}...`); // Log the message indicating waiting for Flask server
        await tcpPortUsed.waitUntilUsed(FLASK_PORT, 5000, 1000); // Wait until the Flask server is up and running
        console.log(`Flask server detected on port ${FLASK_PORT}. Creating Window...`); // Log the message indicating Flask server is detected.
        
    }

}



