const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pos', {
  isDesktop: true,
  appInfo: () => ipcRenderer.invoke('pos:app-info'),
  checkForUpdates: () => ipcRenderer.invoke('pos:check-updates'),
  print: (options) => ipcRenderer.invoke('pos:print', options),
  quitAndInstall: () => ipcRenderer.invoke('pos:quit-and-install'),
  onUpdateStatus: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('pos:update-status', listener);
    return () => ipcRenderer.removeListener('pos:update-status', listener);
  },
});
