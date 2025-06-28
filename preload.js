const { contextBridge, ipcRenderer } = require('electron');
console.log("--- PRELOAD SCRIPT EXECUTING ---");
contextBridge.exposeInMainWorld('electron', {
    // **LOGGING FIX**: This function allows the frontend to receive logs from the main process.
    onBackendLog: (callback) => {
        const handler = (_event, message) => callback(message);
        ipcRenderer.on('backend-log', handler);
        // Return a function to remove the listener for cleanup
        return () => ipcRenderer.removeListener('backend-log', handler);
    },

    startJob: (payload) => ipcRenderer.invoke('start-job', payload),
    getJobStatus: (jobId) => ipcRenderer.invoke('get-job-status', jobId),
    downloadFile: (jobId) => ipcRenderer.invoke('download-file', jobId),
    openFolder: (path) => ipcRenderer.invoke('open-folder', path),
});
