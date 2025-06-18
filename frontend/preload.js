// frontend/preload.js

const { contextBridge, ipcRenderer } = require('electron');

// We are exposing a controlled API to the renderer process (your Next.js app)
// under the name `window.electronAPI`.
contextBridge.exposeInMainWorld('electronAPI', {
    // Each function here corresponds to an ipcMain.handle call in main.js
    // It uses ipcRenderer.invoke which is designed to work with ipcMain.handle
    
    startSingleMp3Job: (args) => ipcRenderer.invoke('start-single-mp3-job', args),

    startPlaylistZipJob: (args) => ipcRenderer.invoke('start-playlist-zip-job', args),
    
    startCombinePlaylistMp3Job: (args) => ipcRenderer.invoke('start-combine-playlist-mp3-job', args),

    getJobStatus: (args) => ipcRenderer.invoke('get-job-status', args),

    // This exposes a listener for update status messages from the main process.
    onUpdateStatus: (callback) => {
        const listener = (event, ...args) => callback(...args);
        ipcRenderer.on('update-status', listener);
        
        // Return a cleanup function to remove the listener
        return () => {
            ipcRenderer.removeListener('update-status', listener);
        };
    },
    
    // This exposes a listener specifically for download progress.
    onUpdateDownloadProgress: (callback) => {
        const listener = (event, ...args) => callback(...args);
        ipcRenderer.on('update-download-progress', listener);
        
        return () => {
            ipcRenderer.removeListener('update-download-progress', listener);
        };
    },
    
    // This invokes the main process to trigger the update and restart.
    restartAndInstall: () => ipcRenderer.send('restart-and-install'),
});
