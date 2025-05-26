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