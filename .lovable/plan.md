# Windows Offline POS — Full Rewrite Plan

Aap ne jo choose kiya (sab offline + LAN multi-PC + cloud mirror + PIN + big-bang) ye current web app ke saath ek **parallel desktop product** hai. Iska matlab poore backend layer ko dobara wire karna hoga. Neeche exact scope, phases, aur trade-offs hain.

## Architecture

```text
┌──────────────────────────────────────────────────────┐
│  Server PC (Mart counter / office)                   │
│  ┌────────────────────────────────────────────────┐  │
│  │ Electron app                                   │  │
│  │  ├─ React UI (current app, repointed)          │  │
│  │  ├─ Local Node API server (port 5544)          │  │
│  │  │   └─ same RPCs: complete_sale, purchase...  │  │
│  │  ├─ Bundled PostgreSQL 16 (data dir in %APPDATA%)│ │
│  │  └─ Sync worker (local → Lovable Cloud, hourly)│  │
│  └────────────────────────────────────────────────┘  │
│               ▲ LAN (192.168.x.x:5544)               │
└───────────────┼──────────────────────────────────────┘
                │
   ┌────────────┼────────────┐
   ▼            ▼            ▼
Cashier PC   Cashier PC   Owner PC   ← Electron in "client" mode,
(POS only)   (POS only)  (all tabs)    hits server PC's API over LAN
```

## What changes in the codebase

**Backend replacement**
- New folder `electron/` — main process, local Postgres launcher, IPC bridge, LAN HTTP server.
- New folder `server/` — Fastify API that mirrors every Supabase RPC (`complete_sale`, `complete_purchase`, `complete_sale_return`, `complete_purchase_return`, `record_payment`, `has_role`, `has_permission`) 1:1 in Postgres running locally. Same SQL bodies reused — Postgres bundled.
- Data client swap: `src/integrations/supabase/client.ts` ko ek thin adapter se replace karenge jo build-time env pe decide kare:
  - `VITE_MODE=desktop` → `http://<server-ip>:5544` pe fetch
  - `VITE_MODE=web` → current Supabase (development ke liye chalta rahega)
  This way saare 30+ route files ko haath nahi lagana padta.

**Auth rewrite**
- Supabase Auth hata denge desktop build me. Naya `users` table (local Postgres) with `pin_hash` (bcrypt), `role`, `permissions`.
- Login screen: staff name select → 4-digit PIN → local server verifies → JWT (short-lived) issue.
- Same permissions system chalega (has_permission), sirf auth source badalta hai.

**LAN discovery**
- Server PC installer pe user IP set kare (ya auto-detect via mDNS/bonjour).
- Cashier installer pehli baar launch pe server IP puchega, `%APPDATA%\pos\config.json` me save.
- Last-write-wins: har row me `updated_at` timestamp, koi conflict resolution nahi (aap ne yehi choose kiya).

**Cloud mirror**
- Hourly cron in main process: local Postgres → `pg_dump --data-only` → chunked upload to Lovable Cloud tables via existing RPCs.
- Restore utility: agar server PC crash ho, naya install → "Restore from cloud" button → cloud se pull.

**Distribution**
- `electron-builder` NSIS installer, 2 targets:
  - `POS-Server-Setup.exe` (~280MB — includes Postgres binaries)
  - `POS-Cashier-Setup.exe` (~120MB — no Postgres, LAN client only)

## Phases (aap ne big-bang chuna, still deliver in visible chunks)

| # | Milestone | What runs at end | Duration signal |
|---|-----------|------------------|-----------------|
| 1 | Electron shell + bundled Postgres + schema migration runner | App khulta hai, local DB ready | 1 large turn |
| 2 | Fastify API server + adapter swap in client | POS billing, purchases, ledgers sab local Postgres pe | 2 large turns |
| 3 | PIN auth + users/roles porting | Login screen, RBAC same as before | 1 turn |
| 4 | LAN client build + config UI | Cashier PC server PC se connect karta hai | 1 turn |
| 5 | Cloud sync worker + restore | Hourly backup, disaster recovery | 1 turn |
| 6 | electron-builder Windows installers | `.exe` files ready to ship | 1 turn |

## Trade-offs aap ko pata hone chahiye

- **Realtime multi-user (current feature)** replaced with **polling every 3s** on cashier PCs — LAN pe socket.io theek chalega but simpler polling zyada reliable hai grocery mart me.
- **Google/email login khtm** desktop me — sirf PIN. Web version alag rahega if aap chahen.
- **Last-write-wins ka matlab**: agar do PCs offline ho aur dono same item bech dein, phir LAN wapas aaye → stock double-deduct nahi hoga (server authoritative) lekin agar dono ne same invoice number claim kiya to unique constraint pe ek fail hoga. Aap ne simple choose kiya, ye consequence bhi.
- **Cloud mirror sirf backup ke liye hai** — cloud se live edit karke desktop nahi update hoga. Ek-tarfa flow.
- **Ye web preview me test nahi ho sakta** — Electron Windows binary sirf `.exe` install karke test hoti hai. Main sandbox me build kar dunga, aap Windows PC pe run karke feedback dengay.
- **Aapka current online data**: pehli baar install pe cloud → local pe ek-time import script chalayenge, sab products/customers/suppliers/ledger aa jayega.

## Approval

Ye plan approve karo to Phase 1 se shuru karta hun: Electron shell + bundled Postgres + schema. Har phase ke baad aap test karke agla bolen — big-bang scope tha lekin delivery visible steps me hogi warna ek turn me itna kaam ship karke bugs pakadna namumkin ho jayega.
