//main.js
const { app, BrowserWindow} = require('electron'); // Importing app and BrowserWindow from electron
const path = require('path'); // Importing path module
const{spawn} = require('child_process'); // Importing spawn from child_process module
const isDev = require('electron-is-dev'); // Importing electron-is-dev module
const tcpPortUsed = require('tcp-port-used'); // Importing tcp-port-used module
const{autoUpdater} = require('electron-updater'); // Importing autoUpdater from electron-updater module