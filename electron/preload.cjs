const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pos', {
  isDesktop: true,
  appInfo: () => ipcRenderer.invoke('pos:app-info'),
  checkForUpdates: () => ipcRenderer.invoke('pos:check-updates'),
  print: (options) => ipcRenderer.invoke('pos:print', options),
  quitAndInstall: () => ipcRenderer.invoke('pos:quit-and-install'),
  // Offline edition license screen (handlers exist only in that edition).
  license: {
    info: () => ipcRenderer.invoke('pos:license-info'),
    activate: (email, password) => ipcRenderer.invoke('pos:license-activate', email, password),
    renew: (code) => ipcRenderer.invoke('pos:license-renew', code),
    continue: () => ipcRenderer.invoke('pos:license-continue'),
  },
  journal: {
    append: (entries) => ipcRenderer.invoke('pos:journal-append', entries),
    read: (monthsBack) => ipcRenderer.invoke('pos:journal-read', monthsBack),
    openFolder: () => ipcRenderer.invoke('pos:journal-open-folder'),
  },
  onUpdateStatus: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('pos:update-status', listener);
    return () => ipcRenderer.removeListener('pos:update-status', listener);
  },
});
