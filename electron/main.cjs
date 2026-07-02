// Electron main process for POS Desktop (Windows)
// Two modes decided by config.json: "server" (runs Postgres + API) or "client" (LAN client)
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const USER_DIR = path.join(app.getPath('userData'));
const CONFIG_PATH = path.join(USER_DIR, 'config.json');
const PG_DATA_DIR = path.join(USER_DIR, 'pgdata');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); }
  catch { return { mode: 'server', serverHost: '127.0.0.1', serverPort: 5544, pgPort: 55432 }; }
}
function saveConfig(cfg) {
  fs.mkdirSync(USER_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let mainWindow;
let pgProcess = null;
let apiServer = null;

async function startEmbeddedPostgres(cfg) {
  // Uses `embedded-postgres` npm package. Downloads Postgres binary on first run,
  // caches under app.getPath('userData')/postgres-<version>.
  const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
  const pg = new EmbeddedPostgres({
    databaseDir: PG_DATA_DIR,
    user: 'pos_admin',
    password: 'pos_local_secret',
    port: cfg.pgPort,
    persistent: true,
  });
  const isFirstRun = !fs.existsSync(PG_DATA_DIR);
  if (isFirstRun) await pg.initialise();
  await pg.start();
  if (isFirstRun) {
    await pg.createDatabase('pos');
    const client = pg.getPgClient('pos');
    await client.connect();
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    await client.query(schema);
    await client.end();
  }
  pgProcess = pg;
  return pg;
}

async function startApiServer(cfg) {
  // Fastify HTTP server, listens on 0.0.0.0:5544 so cashier PCs on LAN can reach it.
  const server = require(path.join(__dirname, 'api-server.cjs'));
  apiServer = await server.start({
    port: cfg.serverPort,
    pgConnection: {
      host: '127.0.0.1', port: cfg.pgPort,
      user: 'pos_admin', password: 'pos_local_secret', database: 'pos',
    },
  });
}

async function bootBackendIfServer(cfg) {
  if (cfg.mode !== 'server') return;
  try {
    await startEmbeddedPostgres(cfg);
    await startApiServer(cfg);
  } catch (err) {
    dialog.showErrorBox('Backend failed to start', String(err?.message || err));
    throw err;
  }
}

function createWindow(cfg) {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    title: 'Grocery POS',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  // Vite build output loaded as file://; index.html expects relative asset paths -> vite.config base:'./'
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  if (process.env.POS_DEV === '1') mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(async () => {
  const cfg = loadConfig();
  await bootBackendIfServer(cfg);
  createWindow(cfg);
});

app.on('window-all-closed', async () => {
  if (apiServer?.close) await apiServer.close();
  if (pgProcess?.stop) await pgProcess.stop();
  if (process.platform !== 'darwin') app.quit();
});

// IPC — renderer uses window.pos.* to read config + set LAN server
ipcMain.handle('pos:get-config', () => loadConfig());
ipcMain.handle('pos:set-config', (_e, next) => { saveConfig(next); return true; });
ipcMain.handle('pos:app-info', () => ({
  version: app.getVersion(),
  hostname: os.hostname(),
  platform: process.platform,
  userDir: USER_DIR,
}));
