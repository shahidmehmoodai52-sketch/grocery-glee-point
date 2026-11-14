// Builds the app bundle for the offline edition: same code, but supabase-js
// points at the local gateway (127.0.0.1) with the offline anon key.
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const { OFFLINE_ANON_KEY } = require('../runtime/gateway.cjs');
const { PORTS } = require('../runtime/local-backend.cjs');
const url = `http://127.0.0.1:${PORTS.gateway}`;
execSync('npx vite build', {
  cwd: path.join(__dirname, '..', '..'),
  stdio: 'inherit',
  env: {
    ...process.env,
    NITRO_PRESET: 'node-server',
    VITE_TILLIX_EDITION: 'offline',
    VITE_SUPABASE_PROXY_URL: url,
    VITE_SUPABASE_URL: url,
    SUPABASE_URL: url,
    VITE_SUPABASE_PUBLISHABLE_KEY: OFFLINE_ANON_KEY,
    SUPABASE_PUBLISHABLE_KEY: OFFLINE_ANON_KEY,
  },
});
