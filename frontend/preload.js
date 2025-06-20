const { contextBridge, ipcRenderer } = require('electron');

// Expose a secure API to the renderer process (your React code).
// We are creating a global 'window.electron' object that your frontend can use.
contextBridge.exposeInMainWorld('electron', {
  // Expose the function to select a directory.
  selectDir: () => ipcRenderer.invoke('select-dir'),

  // Expose the function to get the default downloads path.
  getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),

  // Expose a function to open the file explorer.
  openExplorer: (path) => ipcRenderer.invoke('open-path-in-explorer', path),

  // Expose a generic function to start any kind of job.
  // The frontend will tell it the job type (e.g., 'start-single-mp3-job') and pass arguments.
  startJob: (jobType, args) => ipcRenderer.invoke('start-job', jobType, args),
  
  // Expose a function to check a job's status.
  getJobStatus: (jobId) => ipcRenderer.invoke('get-job-status', jobId)
});
