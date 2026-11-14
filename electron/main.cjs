// Electron main process — offline-first SaaS POS shell.
// Spawns the built TanStack Start Nitro node server locally so the React app
// runs fully offline once cached. Cloud sync + auto-update handled separately.
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const http = require('http');
const { fork } = require('child_process');
const fs = require('fs');
const { setupAutoUpdater, checkForUpdatesNow } = require('./updater.cjs');

const IS_DEV = !!process.env.POS_DEV;
// In the packaged app these live in app.asar.unpacked (electron-builder
// asarUnpack). Point at the real files: the server is loaded with an ESM
// import(), and Node's ESM loader can't read paths inside app.asar.
const unpacked = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const NITRO_ENTRY = unpacked(path.join(__dirname, '..', '.output', 'server', 'index.mjs'));
const NITRO_HOST = unpacked(path.join(__dirname, 'nitro-host.mjs'));
const DEV_URL = process.env.POS_DEV_URL || 'http://localhost:8080';

// Offline edition (desktop-offline/): the database runs on this PC instead
// of the cloud. Set by the offline build's package.json (extraMetadata
// tillixEdition) or TILLIX_EDITION=offline when testing.
const EDITION = process.env.TILLIX_EDITION || (() => {
  try { return require(path.join(__dirname, '..', 'package.json')).tillixEdition || 'online'; } catch { return 'online'; }
})();
const IS_OFFLINE_EDITION = EDITION === 'offline';
let localBackend = null;

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

async function startNitroServer(extraEnv = {}) {
  nitroPort = pickPort();
  // Forked through nitro-host.mjs, which exits as soon as this process is
  // gone (see that file) — so the server never outlives the app.
  nitroChild = fork(NITRO_HOST, [], {
    env: { ...process.env, ...extraEnv, TILLIX_NITRO_ENTRY: NITRO_ENTRY, PORT: String(nitroPort), HOST: '127.0.0.1', NITRO_PORT: String(nitroPort), NITRO_HOST: '127.0.0.1' },
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
    title: 'Tillix POS',
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

function stopNitro() {
  if (nitroChild) { try { nitroChild.kill(); } catch {} nitroChild = null; }
}
// Every way out, not only "last window closed" (an update's quitAndInstall,
// Ctrl+C / SIGTERM, an uncaught error path).
app.on('will-quit', stopNitro);
process.on('exit', stopNitro);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopNitro(); app.quit(); });
}

// One running copy only: a second launch (double-clicked shortcut) focuses
// the open window instead of starting a second server on the same port.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  try {
    let startUrl;
    if (IS_OFFLINE_EDITION) {
      // First launch builds the database (a minute or two): show progress
      // instead of a blank window.
      createWindow('data:text/html;charset=utf-8,' + encodeURIComponent(
        '<body style="background:#0f172a;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
        '<div style="text-align:center"><h2>Tillix POS</h2><p>Preparing database on this PC…</p><p style="opacity:.6;font-size:13px">First start can take a minute or two.</p></div></body>'));
      const { startLocalBackend } = require(path.join(__dirname, '..', 'desktop-offline', 'runtime', 'local-backend.cjs'));
      localBackend = await startLocalBackend({
        dataDir: path.join(app.getPath('userData'), 'offline-db'),
        migrationsDir: path.join(__dirname, '..', 'supabase', 'migrations'),
        log: (...a) => console.log('[offline]', ...a),
      });
      await startNitroServer({ SUPABASE_URL: localBackend.url, SUPABASE_PUBLISHABLE_KEY: localBackend.anonKey });
      startUrl = `http://127.0.0.1:${nitroPort}/dashboard`;
      mainWindow.loadURL(startUrl);
    } else if (IS_DEV) {
      startUrl = `${DEV_URL.replace(/\/$/, '')}/dashboard`;
    } else {
      await startNitroServer();
      startUrl = `http://127.0.0.1:${nitroPort}/dashboard`;
    }
    if (!mainWindow) createWindow(startUrl);
    // The offline edition is updated by installing a new version (USB);
    // it never checks the internet for updates.
    if (!IS_DEV && !IS_OFFLINE_EDITION) setupAutoUpdater(mainWindow);
  } catch (err) {
    dialog.showErrorBox('Failed to start Tillix POS', String(err?.message || err));
    app.quit();
  }
});

// The local Postgres must shut down cleanly (a killed server recovers on the
// next start, but a clean stop avoids that): hold the quit until it's done.
app.on('will-quit', (e) => {
  if (!localBackend) return;
  e.preventDefault();
  const b = localBackend; localBackend = null;
  b.stop().catch(() => {}).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (nitroChild) { try { nitroChild.kill(); } catch {} nitroChild = null; }
  if (localBackend) { const b = localBackend; localBackend = null; b.stop().catch(() => {}); }
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
ipcMain.handle('pos:print', async (_event, options = {}) => {
  const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getFocusedWindow();
  if (!target) return false;
  const copies = Math.max(1, Math.floor(Number(options.copies) || 1));
  return await new Promise((resolve) => {
    target.webContents.print({
      silent: options.silent ?? true,
      printBackground: options.printBackground ?? true,
      deviceName: options.deviceName,
      copies,
    }, (success) => resolve(Boolean(success)));
  });
});
// ---- Offline journal ------------------------------------------------------
// Every write the app queues while offline is also appended, as one JSON
// line, to Documents\Tillix\offline-journal\<YYYY-MM>.jsonl, followed by an
// "uploaded"/"cancelled" line once it syncs. The browser storage that holds
// the sync queue can be wiped (clear site data, profile reset); this plain
// file on disk can't be, so unsynced work can be found and queued again.
function journalDir() {
  return path.join(app.getPath('documents'), 'Tillix', 'offline-journal');
}
const MAX_JOURNAL_LINE = 2 * 1024 * 1024; // one queued write, generously
ipcMain.handle('pos:journal-append', async (_event, entries) => {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 200) return false;
  const lines = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object' || typeof e.kind !== 'string' || typeof e.client_uuid !== 'string') continue;
    const line = JSON.stringify(e);
    if (line.length > MAX_JOURNAL_LINE) continue;
    lines.push(line);
  }
  if (!lines.length) return false;
  const dir = journalDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const month = new Date().toISOString().slice(0, 7);
  await fs.promises.appendFile(path.join(dir, `${month}.jsonl`), lines.join('\n') + '\n', 'utf8');
  return true;
});
ipcMain.handle('pos:journal-read', async (_event, monthsBack) => {
  const dir = journalDir();
  const keep = Math.min(Math.max(Number(monthsBack) || 3, 1), 24);
  let files = [];
  try { files = (await fs.promises.readdir(dir)).filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n)).sort().slice(-keep); }
  catch { return { dir, entries: [] }; }
  const entries = [];
  for (const name of files) {
    const text = await fs.promises.readFile(path.join(dir, name), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch { /* a torn last line after a power cut */ }
    }
  }
  return { dir, entries };
});
ipcMain.handle('pos:journal-open-folder', async () => {
  const dir = journalDir();
  await fs.promises.mkdir(dir, { recursive: true });
  return shell.openPath(dir);
});

ipcMain.handle('pos:quit-and-install', () => {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.quitAndInstall();
});
