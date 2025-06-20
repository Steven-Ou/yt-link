// frontend/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    // NEWLY ADDED: Exposes the function to get the downloads path.
    getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),
    
    // Existing functions
    startSingleMp3Job: (data) => ipcRenderer.invoke('start-single-mp3-job', data),
    startPlaylistZipJob: (data) => ipcRenderer.invoke('start-playlist-zip-job', data),
    startCombinePlaylistMp3Job: (data) => ipcRenderer.invoke('start-combine-playlist-mp3-job', data),
    getJobStatus: (jobId) => ipcRenderer.invoke('get-job-status', jobId),
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    openFolder: (path) => ipcRenderer.invoke('open-folder', path),

    // Update listeners (if you have auto-update functionality)
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_event, value) => callback(value)),
    onUpdateError: (callback) => ipcRenderer.on('update-error', (_event, value) => callback(value)),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
