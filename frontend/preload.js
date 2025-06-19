// --- ELECTRON AND NODE.JS IMPORTS ---
const { contextBridge, ipcRenderer } = require('electron');

// --- EXPOSE APIs TO THE RENDERER ON "window.electronAPI" ---
// This now matches the object your page.js is trying to use.
contextBridge.exposeInMainWorld('electronAPI', {
  // Exposes a function to start the single MP3 download job.
  startSingleMp3Job: (payload) => ipcRenderer.invoke('start-single-mp3-job', payload),
  
  // Exposes a function to start the playlist zip job.
  startPlaylistZipJob: (payload) => ipcRenderer.invoke('start-playlist-zip-job', payload),
  
  // Exposes a function to start the combined playlist job.
  startCombinePlaylistMp3Job: (payload) => ipcRenderer.invoke('start-combine-playlist-mp3-job', payload),

  // Exposes a function to get the status of any running job.
  getJobStatus: (jobId) => ipcRenderer.invoke('get-job-status', jobId),
  
  // --- NEW ---
  // Exposes a function that will be called when the user clicks the final "Download Ready" button.
  // It tells the main process to handle saving the completed file.
  saveCompletedFile: (jobId) => ipcRenderer.invoke('save-completed-file', jobId),
});
