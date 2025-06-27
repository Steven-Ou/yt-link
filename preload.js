// frontend/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    // --- THIS IS THE NEW FUNCTION ---
    // Listens for log messages from the main process and sends them to the frontend.
    onBackendLog: (callback) => ipcRenderer.on('backend-log', (_event, message) => callback(message)),

    /**
     * Starts a download job of any type.
     * @param {object} payload - The job details.
     * @param {string} payload.jobType - The type of job ('singleMp3', 'playlistZip', 'combineMp3').
     * @param {string} payload.url - The YouTube URL for the job.
     * @param {string|null} [payload.cookies] - Optional cookie data for private videos.
     * @returns {Promise<object>} A promise that resolves with the job ID or an error.
     */
    startJob: (payload) => ipcRenderer.invoke('start-job', payload),

    /**
     * Gets the current status of a running job.
     * @param {string} jobId - The ID of the job to check.
     * @returns {Promise<object>} A promise that resolves with the job's status details.
     */
    getJobStatus: (jobId) => ipcRenderer.invoke('get-job-status', jobId),

    /**
     * Tells the main process to download the completed file for a job.
     * The main process handles saving it to the default 'Downloads' folder.
     * @param {string} jobId - The ID of the completed job.
     * @returns {Promise<object>} A promise that resolves with the path to the saved file or an error.
     */
    downloadFile: (jobId) => ipcRenderer.invoke('download-file', jobId),

    /**
     * Opens the specified folder or file in the system's file explorer.
     * @param {string} path - The full path to the folder or file.
     */
    openFolder: (path) => ipcRenderer.invoke('open-folder', path),

    /**
     * Gets the default downloads directory path from the main process.
     * @returns {Promise<string>} A promise that resolves with the path.
     */
    getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),

    // --- Listeners for app updates ---
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_event, value) => callback(value)),
    onUpdateError: (callback) => ipcRenderer.on('update-error', (_event, value) => callback(value)),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
