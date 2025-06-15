// frontend/preload.js

const { contextBridge, ipcRenderer } = require('electron');

// We are exposing a controlled API to the renderer process (your Next.js app)
// instead of exposing the entire ipcRenderer module.
contextBridge.exposeInMainWorld('api', {
    // Each function here corresponds to an ipcMain.handle call in main.js
    // It uses ipcRenderer.invoke which is designed to work with ipcMain.handle
    
    startSingleMp3Job: (args) => ipcRenderer.invoke('start-single-mp3-job', args),

    startPlaylistZipJob: (args) => ipcRenderer.invoke('start-playlist-zip-job', args),

    getJobStatus: (args) => ipcRenderer.invoke('get-job-status', args),

    // You can add other functions here as needed
    // For example, if you need to listen for ongoing progress updates:
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, ...args) => callback(...args)),
});
