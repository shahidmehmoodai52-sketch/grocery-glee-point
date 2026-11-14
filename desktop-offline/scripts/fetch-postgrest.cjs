// Downloads the PostgREST release binary for the target platform into
// desktop-offline/bin/<platform>-<arch>/ (gitignored) and checks its SHA-256.
// Usage: node desktop-offline/scripts/fetch-postgrest.cjs [win32|linux]
'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { execFileSync } = require('child_process');
const VERSION = 'v12.2.3';
const TARGETS = {
  win32: { asset: `postgrest-${VERSION}-windows-x64.zip`, dir: 'win32-x64', bin: 'postgrest.exe' },
  linux: { asset: `postgrest-${VERSION}-linux-static-x64.tar.xz`, dir: 'linux-x64', bin: 'postgrest' },
};
const platform = process.argv[2] || process.platform;
const t = TARGETS[platform];
if (!t) { console.error('unsupported platform', platform); process.exit(1); }
const outDir = path.join(__dirname, '..', 'bin', t.dir);
const out = path.join(outDir, t.bin);
(async () => {
  if (fs.existsSync(out)) { console.log('already present:', out); return; }
  fs.mkdirSync(outDir, { recursive: true });
  const url = `https://github.com/PostgREST/postgrest/releases/download/${VERSION}/${t.asset}`;
  console.log('downloading', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log('sha256', crypto.createHash('sha256').update(buf).digest('hex'), `(${t.asset})`);
  const archive = path.join(outDir, t.asset);
  fs.writeFileSync(archive, buf);
  if (t.asset.endsWith('.zip')) {
    if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force '${archive}' '${outDir}'`]);
    else execFileSync('unzip', ['-o', archive, '-d', outDir]);
  } else {
    execFileSync('tar', ['-xJf', archive, '-C', outDir]);
  }
  fs.rmSync(archive);
  if (!fs.existsSync(out)) throw new Error('binary not found after extract');
  fs.chmodSync(out, 0o755);
  console.log('ok:', out);
})().catch((e) => { console.error(e.message); process.exit(1); });
