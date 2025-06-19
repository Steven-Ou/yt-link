// --- ELECTRON AND NODE.JS IMPORTS ---
const { contextBridge, ipcRenderer } = require('electron');

// --- EXPOSE APIs TO THE RENDERER ON "window.electronAPI" ---
contextBridge.exposeInMainWorld('electronAPI', {
  // --- CORRECTED --- Added selectDirectory to let the user choose a folder.
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  
  startSingleMp3Job: (payload) => ipcRenderer.invoke('start-single-mp3-job', payload),
  startPlaylistZipJob: (payload) => ipcRenderer.invoke('start-playlist-zip-job', payload),
  startCombinePlaylistMp3Job: (payload) => ipcRenderer.invoke('start-combine-playlist-mp3-job', payload),
  getJobStatus: (jobId) => ipcRenderer.invoke('get-job-status', jobId),
  saveCompletedFile: (jobId) => ipcRenderer.invoke('save-completed-file', jobId),
});
