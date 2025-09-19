// preload.js

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  startJob: (payload) => ipcRenderer.invoke("start-job", payload),
  getJobStatus: (jobId) => ipcRenderer.invoke("get-job-status", jobId),
  getVideoFormats: (url) => ipcRenderer.invoke("get-video-formats", url),
  onBackendLog: (callback) => {
    const channel = "backend-log";
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
    return () => {
      ipcRenderer.removeAllListeners(channel);
    };
  },
  openFolder: (filePath) => ipcRenderer.invoke("open-folder", filePath),
});
