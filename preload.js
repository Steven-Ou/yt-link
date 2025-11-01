const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * @param {string} jobId
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  openDownloadFolder: (jobId) =>
    ipcRenderer.invoke("open-download-folder", jobId),

  /**
   * @returns {string} - The URL of the Python backend
   */
  // --- THIS IS THE NEW FUNCTION ---
  getBackendUrl: () => "http://127.0.0.1:5003",
});
