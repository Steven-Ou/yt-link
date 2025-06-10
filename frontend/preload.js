// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Expose specific ipcRenderer listeners to the renderer process
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_event, value) => callback(value)),
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (_event, value) => callback(value)),
  // Send message to the renderer process
  sendRendererAction: (arg) => ipcRenderer.send('renderer-action', arg),
  onMainProcessReply: (callback) => ipcRenderer.on('main-process-reply', (_event, value) => callback(value))
});