const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  startJob: (payload) => ipcRenderer.invoke("start-job", payload),
  getJobStatus: (jobId) => ipcRenderer.invoke("get-job-status", jobId),

  getVideoFormats: (url) => ipcRenderer.invoke("get-video-formats", url),

  downloadFile: (options) => ipcRenderer.invoke("download-file", options),
  openFolder: (filePath) => ipcRenderer.invoke("open-folder", filePath),
  onBackendLog: (callback) => {
    const channel = "backend-log";
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
    return () => {
      ipcRenderer.removeAllListeners(channel);
    };
  },
  onBackendReady: (callback) => {
    ipcRenderer.on("backend-ready", callback);
    return () => ipcRenderer.removeAllListeners("backend-ready");
  },
});
