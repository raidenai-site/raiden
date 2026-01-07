// electron/preload.js
// Security bridge between main process and renderer
// Currently minimal - can be extended for IPC if needed

const { contextBridge } = require('electron');

// Expose safe APIs to the renderer process
contextBridge.exposeInMainWorld('electron', {
    isElectron: true,
    platform: process.platform,
    version: process.versions.electron
});
