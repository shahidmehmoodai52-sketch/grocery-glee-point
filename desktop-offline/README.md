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

## License (phase 2)

- **First start** shows the activation screen: the shop owner signs in with
  their Tillix account (internet needed once). `POST /api/offline-license/activate`
  on tillix.co checks the shop is active and that the caller is its owner,
  then returns a license code for this PC (valid until the shop's current
  subscription/trial ends) and the shop details. The exe installs the code,
  creates the same owner account (same email/password) and shop locally —
  with the same shop code, so invoices read `S-044-1001` as online.
- **Code format** `TLX1.<payload>.<sig>`: Ed25519, signed only on the server
  (`TILLIX_LICENSE_PRIVATE_KEY`), verified on the PC with
  `runtime/license-public.pem`. Bound to the PC's Machine ID (Windows
  MachineGuid) and the shop; a code for another PC or shop is refused.
- **Expiry**: the license expiry is copied into the local
  `tenant_subscriptions`, so the app's own "N days left" popup counts down to
  it. When it passes (checked at start and hourly) the app switches to the
  renewal screen, which shows the Machine ID and shop code.
- **Renewal**: Admin panel → *Offline licenses* (super admin) → pick shop,
  enter Machine ID and date → code (copy / WhatsApp). The shop pastes it.
- **Clock check**: the furthest time the app has seen is stored; a clock wound
  back more than 36 h shows "check the date and time" until it's corrected.

### Server setup (once)
Set `TILLIX_LICENSE_PRIVATE_KEY` in Vercel (Production) to the private key
(PEM or its base64) whose public half is `runtime/license-public.pem`, then
redeploy. Without it the activate/renew endpoints answer "not configured".
Never commit the private key. If it leaks, generate a new pair, replace
`license-public.pem`, rebuild the exe, and re-issue codes.

## Status (phase 1 proof of concept)

Verified on Linux (Electron 43 under Xvfb), internet fully blocked:
first start builds the DB in ~5 s; register shop → add product → POS scan →
sale saved (stock 50→49) → Reports P&L correct; restart keeps login and data.

Not done yet:
- Phase 2 is done (see License above), verified in the exe: activation against
  the real Supabase via a local copy of the API, wrong login refused,
  local shop created, expiry → renewal screen, bad code refused, valid code
  unlocks, clock rollback detected. Admin "issue code" UI not exercised with
  a real super-admin login.
- Phase 3: automatic daily backup + restore; DB upgrade on new versions.
- Parity items in `sql/PARITY_TODO.md` (returns/payments functions, RLS audit).
- Shop staff accounts (uses a cloud server function), email/password reset,
  realtime, file storage are not available offline.
- External calls the app makes (Google Fonts, analytics, IP-country lookup,
  Quran API) fail harmlessly offline; fonts fall back to system fonts.
- Not yet tested on a real Windows PC.
