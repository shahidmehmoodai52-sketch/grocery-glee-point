const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pos', {
  getConfig: () => ipcRenderer.invoke('pos:get-config'),
  setConfig: (cfg) => ipcRenderer.invoke('pos:set-config', cfg),
  appInfo: () => ipcRenderer.invoke('pos:app-info'),
  isDesktop: true,
});
