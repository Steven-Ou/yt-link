// In preload.js

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  startJob: (payload) => ipcRenderer.invoke("start-job", payload),
  getJobStatus: (jobId) => ipcRenderer.invoke("get-job-status", jobId),
  getVideoFormats: (url) => ipcRenderer.invoke("get-video-formats", url),
  
  downloadFile: (payload) => ipcRenderer.invoke("download-file", payload), //

  onBackendLog: (callback) => {
    const listener = (event, message) => callback(message);
    ipcRenderer.on("backend-log", listener);
    return () => ipcRenderer.removeListener("backend-log", listener);
  },
});