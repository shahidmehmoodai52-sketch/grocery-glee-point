# Tillix POS Offline (desktop edition)

A separate desktop build whose data lives only on the PC. The online web app
and the online desktop exe are unchanged.

## How it works

```
Electron main (electron/main.cjs, edition = offline)
  └─ desktop-offline/runtime/local-backend.cjs
       ├─ Postgres 17.6 (embedded-postgres)      127.0.0.1:54329   data: %APPDATA%\Tillix POS Offline\offline-db\pgdata
       ├─ schema.cjs: base → supabase/migrations → live drift (first start, ~5 s)
       ├─ PostgREST 12.2.3 (bundled binary)      127.0.0.1:54331
       └─ gateway.cjs  /rest/v1 → PostgREST, /auth/v1 local sign-in   127.0.0.1:54330
  └─ Nitro app server (same app code)            127.0.0.1:34817
```

The app bundle is built with its Supabase URL pointing at the local gateway,
so every query, RPC and RLS rule runs exactly as in the cloud — against the
same SQL (repo migrations + `sql/1*_live_drift_*.sql`). Per-install random
secrets (`offline-db/secrets.json`): Postgres password, PostgREST login, JWT
secret. Nothing listens beyond 127.0.0.1.

## Build the Windows installer (on Windows)

```
git pull origin main
npm install
npm --prefix desktop-offline install
node desktop-offline/scripts/fetch-postgrest.cjs win32
node desktop-offline/scripts/build-frontend.cjs
npx electron-builder --config electron-builder-offline.yml --win nsis --publish never
```

Output: `electron-release-offline/Tillix-Offline-Setup-<version>.exe` — copy to
USB and install on any Windows x64 PC. App id/name differ from the online exe,
so both can be installed side by side. Uninstalling keeps the database.

## Status (phase 1 proof of concept)

Verified on Linux (Electron 43 under Xvfb), internet fully blocked:
first start builds the DB in ~5 s; register shop → add product → POS scan →
sale saved (stock 50→49) → Reports P&L correct; restart keeps login and data.

Not done yet:
- Phase 2: first-run activation online + license with expiry and renewal code
  (the 7-day trial banner from `register_shop` still shows).
- Phase 3: automatic daily backup + restore; DB upgrade on new versions.
- Parity items in `sql/PARITY_TODO.md` (returns/payments functions, RLS audit).
- Shop staff accounts (uses a cloud server function), email/password reset,
  realtime, file storage are not available offline.
- External calls the app makes (Google Fonts, analytics, IP-country lookup,
  Quran API) fail harmlessly offline; fonts fall back to system fonts.
- Not yet tested on a real Windows PC.
