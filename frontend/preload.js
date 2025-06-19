// frontend/preload.js

const { contextBridge, ipcRenderer } = require('electron');

// Expose a controlled API to the renderer process (Next.js app) under `window.electronAPI`.
contextBridge.exposeInMainWorld('electronAPI', {
    // Functions to start the different types of jobs.
    startSingleMp3Job: (args) => ipcRenderer.invoke('start-single-mp3-job', args),
    startPlaylistZipJob: (args) => ipcRenderer.invoke('start-playlist-zip-job', args),
    startCombinePlaylistMp3Job: (args) => ipcRenderer.invoke('start-combine-playlist-mp3-job', args),

    // Function to check the status of a job.
    getJobStatus: (jobId) => ipcRenderer.invoke('get-job-status', jobId),
    
    // **NEW:** Function to trigger the save file dialog in the main process.
    saveFile: (jobInfo) => ipcRenderer.invoke('save-file', jobInfo),

    // Listener for general update status messages from the main process.
    onUpdateStatus: (callback) => {
        const listener = (event, ...args) => callback(...args);
        ipcRenderer.on('update-status', listener);
        // Return a cleanup function to remove the listener.
        return () => ipcRenderer.removeListener('update-status', listener);
    },
    
    // Listener specifically for download progress percentages.
    onUpdateDownloadProgress: (callback) => {
        const listener = (event, ...args) => callback(...args);
        ipcRenderer.on('update-download-progress', listener);
        return () => ipcRenderer.removeListener('update-download-progress', listener);
    },
    
    // Function to trigger the application restart and update installation.
    restartAndInstall: () => ipcRenderer.send('restart-and-install'),
});
