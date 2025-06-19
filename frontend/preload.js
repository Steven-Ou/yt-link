// --- ELECTRON AND NODE.JS IMPORTS ---
// 'contextBridge' is the module used to securely expose APIs from the preload script
// to the renderer process (your Next.js app).
// 'ipcRenderer' is used to send messages from the renderer process to the main process.
const { contextBridge, ipcRenderer } = require('electron');

// --- EXPOSE APIs TO THE RENDERER ---
// We use 'contextBridge.exposeInMainWorld' to create a global object 'window.electron'
// that the frontend code can access. This is the secure way to set up the IPC bridge.
contextBridge.exposeInMainWorld('electron', {
  // --- JOB STARTING FUNCTIONS ---
  // These functions will be called from your React components. They take the necessary
  // data (like the URL) and use 'ipcRenderer.invoke' to send a message to the main process.
  // 'ipcRenderer.invoke' is asynchronous and returns a Promise with the result.
  
  startSingleMp3Job: (url, outputDir) => 
    ipcRenderer.invoke('start-single-mp3-job', { url, outputDir }),
  
  startPlaylistZipJob: (url, outputDir, playlistTitle) => 
    ipcRenderer.invoke('start-playlist-zip-job', { url, outputDir, playlistTitle }),

  // --- JOB STATUS AND DOWNLOAD FUNCTIONS ---
  // These functions allow the frontend to check the status of a running job
  // and to initiate the download of a completed file.
  
  getJobStatus: (jobId) => 
    ipcRenderer.invoke('get-job-status', jobId),
    
  // Note: For file downloads, a different pattern is sometimes used, but invoking
  // a download path or command is a common approach. The main process will handle it.
  downloadFile: (jobId) => 
    ipcRenderer.invoke('download-file', jobId),

  // --- DIALOG FUNCTION ---
  // Exposes a way for the renderer to ask the main process to open a file dialog.
  // This is a secure way to let users select a directory.
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
});
