// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to communicate
// with the main process without exposing the entire ipcRenderer object.
contextBridge.exposeInMainWorld('electronAPI', {
  // --- LISTENERS: From Main Process to Renderer Process ---

  /**
   * Listens for general status updates from the auto-updater.
   * @param {function} callback - The function to call with the status message.
   * @returns {function} A function to remove the event listener.
   */
  onUpdateStatus: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },

  /**
   * Listens for download progress updates.
   * @param {function} callback - The function to call with the progress object.
   * @returns {function} A function to remove the event listener.
   */
  onUpdateDownloadProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('update-download-progress', listener);
    return () => ipcRenderer.removeListener('update-download-progress', listener);
  },

  /**
   * Listens for a reply from the main process (example).
   * @param {function} callback - The function to call with the reply data.
   * @returns {function} A function to remove the event listener.
   */
  onMainProcessReply: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('main-process-reply', listener);
    return () => ipcRenderer.removeListener('main-process-reply', listener);
  },


  // --- SENDERS: From Renderer Process to Main Process ---
  
  /**
   * Sends an action/message from the renderer process to the main process (example).
   * @param {*} arg - The argument or data to send.
   */
  sendRendererAction: (arg) => ipcRenderer.send('renderer-action', arg)
});