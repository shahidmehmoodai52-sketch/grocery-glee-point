// Auto-updater — pulls .exe from GitHub Releases feed (configured in electron-builder.yml).
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function setupAutoUpdater(win) {
  autoUpdater.on('checking-for-update', () => send(win, 'pos:update-status', { state: 'checking' }));
  autoUpdater.on('update-available',    (i) => send(win, 'pos:update-status', { state: 'available', version: i?.version }));
  autoUpdater.on('update-not-available',() => send(win, 'pos:update-status', { state: 'none' }));
  autoUpdater.on('download-progress',   (p) => send(win, 'pos:update-status', { state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded',   (i) => send(win, 'pos:update-status', { state: 'ready', version: i?.version }));
  autoUpdater.on('error',               (e) => send(win, 'pos:update-status', { state: 'error', message: String(e?.message || e) }));

  // Kick off first check shortly after boot, then every 4 hours.
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

async function checkForUpdatesNow() {
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, version: r?.updateInfo?.version };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

module.exports = { setupAutoUpdater, checkForUpdatesNow };
