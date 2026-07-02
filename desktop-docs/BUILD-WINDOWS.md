# Grocery POS — Windows Build Guide

Ye Electron desktop build hai. Web preview (Lovable) me test nahi hoga — sirf Windows PC pe.

## Ek-baar setup (developer machine)

```powershell
# Node 20+ chahiye
npm install
npm install --save electron@31 fastify @fastify/cors pg bcryptjs jsonwebtoken embedded-postgres
npm install --save-dev electron-builder
```

## Build

```powershell
# 1. Web bundle (Vite) → dist/
npm run build

# 2. Server variant (bundled Postgres, ~280MB installer)
$env:POS_ROLE="Server"; npx electron-builder --config electron-builder.yml --win nsis

# 3. Cashier variant (LAN client only, ~120MB installer)
#    (Postgres binaries excluded; cashier PCs connect to server PC's IP)
$env:POS_ROLE="Cashier"; npx electron-builder --config electron-builder.yml --win nsis --config.extraResources= --config.asarUnpack=
```

Output: `electron-release\POS-Server-Setup-<ver>.exe` aur `POS-Cashier-Setup-<ver>.exe`. Ye files USB/WhatsApp pe bhej sakte ho.

## Install order at the mart

1. **Server PC** (jo kabhi bhi off na ho — office desk / counter):
   - `POS-Server-Setup.exe` install → launch → pehli baar Postgres data dir bane ga `%APPDATA%\Grocery POS\pgdata\`
   - Default admin PIN: **1234** — Users tab se change kar dena.
   - Windows Firewall me port 5544 aur 55432 allow karo (installer prompt karega).
   - Server PC ka LAN IP note karo: `ipconfig` → IPv4 Address (jaise `192.168.1.10`).

2. **Cashier PCs** (billing counters):
   - `POS-Cashier-Setup.exe` install → launch → pehli screen pe Server IP daalo (`192.168.1.10`) aur port `5544`.
   - PIN se login karo.

## Data migration from cloud (ek-baar)

Server PC pe pehli baar setup ke baad:
- Settings → Backup → **Import from Cloud** → sab products/customers/suppliers/ledger cloud se local Postgres me aa jayenge.

## Cloud mirror

Har ghante local Postgres se cloud pe backup push ho jata hai (jab internet available ho). Agar server PC crash ho:
- Naya PC pe `POS-Server-Setup.exe` install karo → "Restore from Cloud" → last backup se restart.

## Troubleshooting

| Issue | Fix |
|---|---|
| Cashier PC pe "Cannot connect to server" | Server PC ka IP + firewall check karo |
| Postgres port already in use | Config file me `pgPort` change karo: `%APPDATA%\Grocery POS\config.json` |
| PIN bhool gaye | Server PC pe `psql` se `UPDATE app_users SET pin_hash = crypt('1234', gen_salt('bf')) WHERE role='admin';` |
