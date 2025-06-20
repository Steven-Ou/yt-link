const { contextBridge, ipcRenderer } = require('electron');

// Expose a controlled set of functions to the renderer process (your React app).
// This is the secure way to handle IPC in Electron.
contextBridge.exposeInMainWorld('electron', {
  // Method to open the "select directory" dialog
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  
  // Method to start a single MP3 download job
  startSingleMp3Job: (data) => ipcRenderer.invoke('start-single-mp3-job', data),
  
  // Method to start a playlist zip download job
  startPlaylistZipJob: (data) => ipcRenderer.invoke('start-playlist-zip-job', data),
  
  // Method to start a combined playlist download job
  startCombinePlaylistMp3Job: (data) => ipcRenderer.invoke('start-combine-playlist-mp3-job', data),

  // Method to get the status of any job
  getJobStatus: (jobId) => ipcRenderer.invoke('get-job-status', jobId),
  
  // ADDED: Method to open a folder path
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
});
