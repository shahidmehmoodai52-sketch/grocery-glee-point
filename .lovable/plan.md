
# Offline-First SaaS POS — Rebuild Plan

Pichla Phase 1 (local Postgres + LAN Fastify) delete kar ke ek **true offline-first SaaS** banayenge. Cloud (Lovable) primary rahega, har PC apna local cache + write queue rakhega, net wapas aate hi auto-sync. GitHub Releases se auto-update.

## Architecture

```text
┌─ Windows .exe (Electron, auto-update on)  ─────────────┐
│                                                        │
│  Existing React app (kuch nahi todna)                  │
│    │                                                   │
│    ├─ Supabase client (unchanged)                      │
│    │                                                   │
│    └─ NEW: offline layer (src/lib/offline/)            │
│        ├─ cache.ts     → Dexie/IndexedDB mirror of     │
│        │                 products, barcodes, customers,│
│        │                 suppliers, expense_persons,   │
│        │                 store_settings, user_perms    │
│        │                                               │
│        ├─ outbox.ts    → queue of pending writes       │
│        │                 (sales, purchases, returns,   │
│        │                 expenses, payments, edits)    │
│        │                                               │
│        ├─ sync.ts      → net-status listener; drain    │
│        │                 outbox to Supabase RPCs in    │
│        │                 order; re-pull cache on push  │
│        │                                               │
│        └─ data-client  → thin wrapper: online = direct │
│                          Supabase, offline = cache+queue│
│                                                        │
│  Electron shell (electron/main.cjs)                    │
│    ├─ BrowserWindow loads local dist/ (works offline)  │
│    ├─ electron-updater → GitHub Releases feed          │
│    └─ Update UI: "Update ready, restart"               │
└────────────────────────────────────────────────────────┘
```

## Delivery in stages (aap ke big-bang ke andar visible chunks)

| # | Stage | End state |
|---|-------|-----------|
| A | **Cleanup + Electron shell + auto-updater** | Purana Phase 1 code deleted. `pnpm dev:electron` chalne se app khulti hai. `pnpm build:win` se .exe banti hai. GitHub release publish karo → installed app auto-download karke restart pe update ho jati hai. |
| B | **Offline cache (read-side)** | Dexie schema, initial pull, background refresh. Net band ho to products/customers/suppliers/settings sab load hote hain — POS UI khulti hai, search chalta hai, purani sales dikhti hain. |
| C | **Outbox queue (write-side)** | Sale complete, purchase, return, expense, payment — sab offline mode me local queue me jate hain, temporary local ID milta hai, stock local cache me adjust hota hai. UI me "Pending sync: 3" badge. |
| D | **Sync worker + conflict rules** | Net wapas aate hi outbox drain (FIFO), server RPCs same use hote hain (`complete_sale` etc.), success pe local ID → real UUID map, cache refresh. Fail hone pe row `sync_error` state me jaati hai, user manually retry kar sakta hai. |
| E | **Auto-update polish + installer signing hints** | `checkForUpdates` on app start + har 4 ghante, download progress toast, "Restart to install" button. `desktop-docs/RELEASE.md` — kaise GitHub token set karke `pnpm release` chalana hai. |

Har stage ke baad aap test karke "next" bolen.

## Trade-offs (senior-dev honesty)

- **Realtime multi-user offline pe kaam nahi karega** — ye by design hai. Do PCs jab dono offline hon aur same item sell karen, dono ka stock local -1 hoga; net aane pe dono queue push hongi, server pe stock -2 ho jayega. Agar stock neeche 0 chala jaye to warning toast dikhayenge, block nahi karenge (grocery mart me realistic hai — bhai actual stock physical hai, digital sirf tracking hai).
- **Invoice numbers offline me temporary honge** (`OFFLINE-<timestamp>`), sync ke baad server ka real invoice number replace ho jayega. Print receipt me clearly marked "Pending sync" jab tak sync na ho.
- **Returns offline me** original sale ka reference chahiye — agar wo bhi offline queue me hai to return bhi queue me chala jayega aur sync order maintain hoga (sale pehle, phir return).
- **Purchases WAC (weighted average cost)** offline me local calc karenge; sync pe server dobara calc karega — chhota discrepancy ho sakta hai agar do PCs ne offline purchase kiya. Owner dashboard me "Cost drift" alert dikha denge agar variance >2%.
- **Auto-update ke liye GitHub repo public ho ya private + token** — private repo me har user PC me update token embed karna padta hai. Public repo (compiled binary, code alag) recommend karta hun.
- **Pehli baar cache populate hone ke liye net chahiye** — fresh install offline nahi ho sakta.
- **Editor preview me offline test nahi hota** — Electron app chahiye. Har stage ke baad main aap ko `.exe` build karke dunga, aap PC pe test karo.

## Files touched summary

**Delete:** `electron/api-server.cjs`, `api-tables.cjs`, `api-rpcs.cjs`, `schema.sql`, `.lovable/plan.md` (replaced by this).

**New:** `electron/main.cjs` (rewrite, lighter), `electron/preload.cjs`, `electron/updater.cjs`, `src/lib/offline/{cache,outbox,sync,data-client,dexie-schema}.ts`, `src/hooks/use-online.ts`, `src/components/sync-badge.tsx`, `desktop-docs/RELEASE.md`.

**Modified:** `package.json` (scripts + electron-updater dep), `electron-builder.yml` (GitHub publish target), `src/routes/_authenticated/route.tsx` (sync badge + boot cache), key write sites in POS/purchases/returns/expenses (route through data-client).

## Approve karo to Stage A shuru karun

Stage A me sirf cleanup + Electron shell + auto-updater lagegi — aapke offline features abhi nahi aayenge lekin app installable + auto-updating ban jayegi. Phir Stage B se offline layer.
