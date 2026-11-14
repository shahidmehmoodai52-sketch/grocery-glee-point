// Offline desktop edition: run the whole backend on this PC.
//   Postgres (embedded-postgres binaries) → schema (schema.cjs) →
//   PostgREST (bundled binary) → gateway (gateway.cjs) on 127.0.0.1.
// All data lives in <dataDir>/pgdata. Nothing here talks to the internet.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const unpacked = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

const PORTS = { pg: 54329, gateway: 54330, postgrest: 54331 };

function loadSecrets(dataDir) {
  const f = path.join(dataDir, 'secrets.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const s = {
    pgPassword: crypto.randomBytes(24).toString('base64url'),
    authenticatorPassword: crypto.randomBytes(24).toString('base64url'),
    jwtSecret: crypto.randomBytes(48).toString('base64url'),
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(s), { mode: 0o600 });
  return s;
}

function postgrestBinary() {
  const name = process.platform === 'win32' ? 'postgrest.exe' : 'postgrest';
  return unpacked(path.join(ROOT, 'bin', `${process.platform}-${process.arch}`, name));
}

async function startLocalBackend({ dataDir, migrationsDir, log = console.log }) {
  // embedded-postgres is ESM-only (no "main"), so load its entry by URL.
  const { pathToFileURL } = require('url');
  const EmbeddedPostgres = (await import(pathToFileURL(unpacked(path.join(ROOT, 'node_modules', 'embedded-postgres', 'dist', 'index.js'))).href)).default;
  const { Pool } = require(unpacked(path.join(ROOT, 'node_modules', 'pg')));
  const { ensureSchema } = require('./schema.cjs');
  const { createGateway, OFFLINE_ANON_KEY } = require('./gateway.cjs');

  const secrets = loadSecrets(dataDir);
  const pgDir = path.join(dataDir, 'pgdata');
  const fresh = !fs.existsSync(path.join(pgDir, 'PG_VERSION'));

  const pg = new EmbeddedPostgres({
    databaseDir: pgDir, user: 'postgres', password: secrets.pgPassword, port: PORTS.pg,
    persistent: true, onLog: () => {}, onError: (m) => log('[pg]', String(m).trim()),
  });
  if (fresh) await pg.initialise();
  // After a crash or a killed app the old server may still be running on
  // this data directory; reuse it instead of failing on its lock file.
  const probe = new Pool({ host: '127.0.0.1', port: PORTS.pg, user: 'postgres', password: secrets.pgPassword, database: 'postgres', max: 1, connectionTimeoutMillis: 1500 });
  const alreadyUp = await probe.query('SELECT 1').then(() => true, () => false);
  await probe.end().catch(() => {});
  if (!alreadyUp) await pg.start();

  const pool = new Pool({ host: '127.0.0.1', port: PORTS.pg, user: 'postgres', password: secrets.pgPassword, database: 'postgres', max: 4 });
  const schema = await ensureSchema(pool, { sqlDir: unpacked(path.join(ROOT, 'sql')), migrationsDir: unpacked(migrationsDir), log });
  if (schema.failed.length) log('[schema] not applied:', schema.failed.join(' | '));
  await pool.query(`ALTER ROLE authenticator WITH LOGIN PASSWORD '${secrets.authenticatorPassword.replace(/'/g, "''")}'`);

  const conf = path.join(dataDir, 'postgrest.conf');
  fs.writeFileSync(conf, [
    `db-uri = "postgres://authenticator:${secrets.authenticatorPassword}@127.0.0.1:${PORTS.pg}/postgres"`,
    'db-schemas = "public"', 'db-anon-role = "anon"', 'db-extra-search-path = "public, extensions"',
    `jwt-secret = "${secrets.jwtSecret}"`, 'server-host = "127.0.0.1"', `server-port = ${PORTS.postgrest}`, 'db-pool = 10',
  ].join('\n'), { mode: 0o600 });
  const rest = spawn(postgrestBinary(), [conf], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  rest.stderr.on('data', (d) => log('[postgrest]', String(d).trim()));
  await waitFor(`http://127.0.0.1:${PORTS.postgrest}/`, 20000);

  const gateway = createGateway({ pool, secret: secrets.jwtSecret, postgrestPort: PORTS.postgrest, port: PORTS.gateway, log });
  await gateway.listen();

  return {
    url: `http://127.0.0.1:${PORTS.gateway}`,
    anonKey: OFFLINE_ANON_KEY,
    /** Superuser query on the local DB (license sync, local shop setup). */
    query: async (sql, params) => (await pool.query(sql, params)).rows,
    async stop() {
      try { await gateway.close(); } catch {}
      try { rest.kill(); } catch {}
      try { await pool.end(); } catch {}
      try { await pg.stop(); } catch {}
    },
  };
}

function waitFor(url, ms) {
  const http = require('http');
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, (res) => { res.resume(); resolve(); }).on('error', () => {
        if (Date.now() - t0 > ms) reject(new Error('Local database API did not start'));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

module.exports = { startLocalBackend, PORTS };
