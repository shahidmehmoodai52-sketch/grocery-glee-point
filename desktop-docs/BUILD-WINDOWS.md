# Grocery POS — Windows Build Guide

Ye Electron desktop build hai. Web preview (Lovable) me test nahi hoga — sirf Windows PC pe.

## Requirements

- Node 20+ / Bun 1.x
- Windows 10/11 (build machine)
- Internet (pehli install pe cache populate karne ke liye)

## Install deps (ek baar)

```powershell
bun install
```

## Development

Do terminals:

```powershell
# Terminal 1 — TanStack Start dev server (Vite)
bun run dev

# Terminal 2 — Electron window pointing to dev server
bun run electron:dev
```

## Local test build (installer only, no publish)

```powershell
bun run electron:pack
```

Output: `electron-release\GroceryPOS-Setup-<version>.exe`. Ye file USB/WhatsApp pe bhej sakte ho.

## Publish with auto-update

Full flow `desktop-docs/RELEASE.md` me hai:

```powershell
bun run electron:release
```

## Architecture note

App **SaaS hai** — data Lovable Cloud (Supabase) pe live rehta hai. Electron shell sirf isliye hai ki:

1. Users ko `.exe` install experience mile (browser open karne ki zaroorat nahi)
2. Naye updates auto-install hon (GitHub Releases se)
3. Offline mode (Stage B ke baad) — net na ho to POS local cache + queue me chalti rahegi

Har PC independent hai — kisi ko "server PC" banane ki zaroorat nahi, LAN configure karne ki zaroorat nahi. Sab PCs seedhe cloud se sync hote hain.

## Troubleshooting

**"Local server did not start in time"** — `.output/server/index.mjs` build hua nahi hai. `bun run electron:build` phir chalao.

**Blank white window** — Nitro server bind fail hua. Task Manager me `node.exe` dhoondh ke kill karo, phir app restart.

**Windows SmartScreen warning** — .exe signed nahi hai. "More info" → "Run anyway" click karo, ya code-signing certificate lagao (RELEASE.md dekho).
