// Offline edition license: a code signed by tillix.co (Ed25519), checked on
// the PC with the public key below — no internet needed to verify it.
//
//   TLX1.<base64url(JSON payload)>.<base64url(signature)>
//   payload: { v, kind, lid, tid, shop, sc, em, mid, iat, exp }
//     tid  = the shop's cloud id      sc = shop code (shown to support)
//     mid  = this PC's Machine ID     exp = expiry (unix seconds)
//
// The same format is used for the first activation and for renewal codes,
// so a renewal is just a new code with a later expiry for the same shop
// and PC. The private key never leaves the tillix.co server.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PUBLIC_KEY = fs.readFileSync(path.join(__dirname, 'license-public.pem'), 'utf8');
const PREFIX = 'TLX1';
/** Allowed backwards clock drift before we treat the date as tampered. */
const CLOCK_TOLERANCE_MS = 36 * 60 * 60 * 1000;
/** Show the renewal reminder this many days before expiry. */
const WARN_DAYS = 5;

const b64urlDecode = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Stable per-PC id, readable to the user (XXXX-XXXX-XXXX). Windows:
 *  MachineGuid from the registry (survives app reinstalls); Linux:
 *  /etc/machine-id; otherwise hostname + CPU + platform. */
function machineId() {
  let raw = '';
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
      raw = (out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/) || [])[1] || '';
    } else if (fs.existsSync('/etc/machine-id')) {
      raw = fs.readFileSync('/etc/machine-id', 'utf8').trim();
    }
  } catch { /* fall through */ }
  if (!raw) raw = [os.hostname(), (os.cpus()[0] || {}).model, os.platform(), os.arch()].join('|');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const h = crypto.createHash('sha256').update('tillix-offline|' + raw).digest();
  let id = '';
  for (let i = 0; i < 12; i++) id += alphabet[h[i] % alphabet.length];
  return `${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8, 12)}`;
}

/** Parse and verify a code's signature. Returns the payload or throws. */
function decode(token) {
  const t = String(token || '').replace(/\s+/g, '');
  const parts = t.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) throw new Error('This is not a Tillix license code.');
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  const ok = crypto.verify(null, data, PUBLIC_KEY, b64urlDecode(parts[2]));
  if (!ok) throw new Error('License code is invalid (signature check failed).');
  let p;
  try { p = JSON.parse(b64urlDecode(parts[1]).toString('utf8')); } catch { throw new Error('License code is damaged.'); }
  if (p.v !== 1 || !p.tid || !p.mid || !p.exp) throw new Error('License code is incomplete.');
  return p;
}

function licenseFile(dataDir) { return path.join(dataDir, 'license.json'); }

function load(dataDir) {
  try { return JSON.parse(fs.readFileSync(licenseFile(dataDir), 'utf8')); } catch { return null; }
}

function save(dataDir, state) {
  fs.mkdirSync(dataDir, { recursive: true });
  const f = licenseFile(dataDir);
  fs.writeFileSync(f + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(f + '.tmp', f);
}

/** Current license status for this PC.
 *  { state: 'missing' | 'invalid' | 'wrong_machine' | 'clock' | 'expired' | 'ok', payload?, daysLeft?, warn?, message? } */
function check(dataDir, now = Date.now()) {
  const st = load(dataDir);
  if (!st || !st.token) return { state: 'missing' };
  let p;
  try { p = decode(st.token); } catch (e) { return { state: 'invalid', message: e.message }; }
  const mid = machineId();
  if (p.mid !== mid) return { state: 'wrong_machine', payload: p, message: 'This license belongs to a different PC.' };
  const lastSeen = Number(st.lastSeen || 0);
  if (lastSeen && now < lastSeen - CLOCK_TOLERANCE_MS) {
    return { state: 'clock', payload: p, message: "This PC's date/time is earlier than when Tillix last ran. Correct the date and time, then restart." };
  }
  const msLeft = p.exp * 1000 - now;
  const daysLeft = Math.ceil(msLeft / 86400000);
  if (msLeft <= 0) return { state: 'expired', payload: p, daysLeft: 0 };
  // Remember the furthest time seen, so winding the clock back is noticed.
  if (now > lastSeen) save(dataDir, { ...st, lastSeen: now });
  return { state: 'ok', payload: p, daysLeft, warn: daysLeft <= WARN_DAYS };
}

/** Install a code (activation or renewal). It must be for this PC, and a
 *  renewal must be for the shop this PC was activated for. */
function install(dataDir, token, now = Date.now()) {
  const p = decode(token);
  if (p.mid !== machineId()) throw new Error(`This code is for a different PC (Machine ID ${p.mid}).`);
  const prev = load(dataDir);
  if (prev && prev.token) {
    let old = null;
    try { old = decode(prev.token); } catch { /* replace a damaged one */ }
    if (old && old.tid !== p.tid) throw new Error('This code is for a different shop.');
  }
  if (p.exp * 1000 <= now) throw new Error('This code has already expired.');
  save(dataDir, { token: String(token).replace(/\s+/g, ''), installedAt: now, lastSeen: Math.max(now, Number(prev && prev.lastSeen) || 0) });
  return p;
}

module.exports = { machineId, decode, check, install, load, WARN_DAYS, PREFIX };
