// Electron main process — offline-first SaaS POS shell.
// Spawns the built TanStack Start Nitro node server locally so the React app
// runs fully offline once cached. Cloud sync + auto-update handled separately.
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const http = require('http');
const { fork } = require('child_process');
const { setupAutoUpdater, checkForUpdatesNow } = require('./updater.cjs');

const IS_DEV = !!process.env.POS_DEV;
const NITRO_ENTRY = path.join(__dirname, '..', '.output', 'server', 'index.mjs');
const DEV_URL = process.env.POS_DEV_URL || 'http://localhost:8080';

let mainWindow = null;
let nitroChild = null;
let nitroPort = 0;

// Fixed local port so the app origin (and therefore localStorage / Supabase
// session persistence) stays stable across restarts. Bound to 127.0.0.1 only,
// so there is no LAN exposure. If a user genuinely has 34817 taken, they can
// override via POS_PORT.
function pickPort() {
  const override = Number(process.env.POS_PORT);
  if (Number.isFinite(override) && override > 0) return override;
  return 34817;
}

function waitForServer(url, timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) return reject(new Error('Local server did not start in time'));
        setTimeout(tick, 200);
      });
    };
    tick();
  });
}

async function startNitroServer() {
  nitroPort = pickPort();
  nitroChild = fork(NITRO_ENTRY, [], {
    env: { ...process.env, PORT: String(nitroPort), HOST: '127.0.0.1', NITRO_PORT: String(nitroPort), NITRO_HOST: '127.0.0.1' },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  nitroChild.on('exit', (code) => {
    console.error('[nitro] exited', code);
    nitroChild = null;
  });
  await waitForServer(`http://127.0.0.1:${nitroPort}/`);
}

function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Grocery POS',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(startUrl);
  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Open external links in the OS browser, not a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  try {
    let startUrl;
    if (IS_DEV) {
      startUrl = DEV_URL;
    } else {
      await startNitroServer();
      startUrl = `http://127.0.0.1:${nitroPort}/`;
    }
    createWindow(startUrl);
    if (!IS_DEV) setupAutoUpdater(mainWindow);
  } catch (err) {
    dialog.showErrorBox('Failed to start Grocery POS', String(err?.message || err));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (nitroChild) { try { nitroChild.kill(); } catch {} nitroChild = null; }
  if (process.platform !== 'darwin') app.quit();
});

// IPC surface for renderer (window.pos.*)
ipcMain.handle('pos:app-info', () => ({
  version: app.getVersion(),
  hostname: os.hostname(),
  platform: process.platform,
  userDir: app.getPath('userData'),
}));
ipcMain.handle('pos:check-updates', () => checkForUpdatesNow());
ipcMain.handle('pos:quit-and-install', () => {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.quitAndInstall();
});
