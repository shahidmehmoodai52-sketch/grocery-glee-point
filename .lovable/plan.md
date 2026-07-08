
# Review button + Full offline mode

## Scope

Do cheezein deliver karenge:

1. **POS Reprint mein "Review" button** — chhota, is turn mein hoga.
2. **Full offline mode** — bara kaam, phases mein karenge (ye plan turn 1 ka scope define karta hy, aur baaki turns ka roadmap).

## User flow (offline)

1. Settings → Backup & Offline mein ek "Enable offline mode" button.
2. User ek folder pick karta hy (File System Access API). Us folder mein local database (IndexedDB) ka periodic snapshot store hoga plus offline queue ka mirror.
3. App boot par: agar folder connected hy, sab reads pehle local cache se, phir background mein cloud se refresh.
4. Net na ho to: reads local se, writes local queue mein jama (already `sync_queue` table exists).
5. Net wapas: queue flush cloud pe, conflicts resolve, cache refresh.
6. Ek status badge (top bar) — 🟢 Online-synced / 🟡 Offline (X pending) / 🔴 Sync error.

## Phase plan

### Turn 1 (is message mein) — foundation + Review button
- POS Reprint dialog mein har row ke saath **Review** (eye) button add karo — sirf invoice kholta hy, reprint audit log nahi karta.
- **Offline core infrastructure**:
  - `src/lib/offline/db.ts` — Dexie (IndexedDB wrapper) schema jo saari core tables mirror kare: products, customers, suppliers, sales, sale_items, purchases, expenses, store_settings, user_roles, product_barcodes.
  - `src/lib/offline/status.ts` — network status hook + pending-queue counter.
  - `src/lib/offline/sync.ts` — bidirectional sync engine (pull from cloud → cache; push queue → cloud) using `updated_at` watermark.
  - `src/lib/offline/cached-query.ts` — helper jo TanStack Query ke saath integrate karta hy: pehle IndexedDB se dikhao, phir cloud fetch overwrite kare.
  - `src/components/offline-status.tsx` — badge/indicator top bar mein.
  - `src/routes/_authenticated/settings.tsx` mein "Offline mode" section add karo.
- Sync abhi POS reads (products, customers) aur POS writes (sales) ke liye enable hogi.

### Turn 2 — POS full offline (Stage 1)
- POS route ki har query offline-first bana denge.
- Sale checkout offline queue mein — invoice number local prefix ke saath, sync par server number assign.
- Product stock decrement local optimistic, reconcile on sync.

### Turn 3 — Purchases + Inventory offline (Stage 2a)
- Purchases, purchase returns, sale returns, stock counts offline.
- Conflict rule: server wins on stock, local wins on notes/metadata.

### Turn 4 — Expenses, Customers, Suppliers, Settings offline (Stage 2b)
- Baaki CRUD modules offline.
- Reports abhi online-only rahenge (ye batayenge user ko).

### Turn 5 — polish, folder-snapshot export, testing
- Nightly IndexedDB → chosen folder JSON snapshot (disaster recovery).
- End-to-end offline test flow.

## Technical details

- **Storage**: IndexedDB via `dexie` (~15 KB gz, well-tested). File System Access API sirf snapshot dump ke liye — actual working store IndexedDB (fast, indexed).
- **Sync watermark**: har mirrored table par `updated_at` column already hai; local `_sync_state` table mein last pulled timestamp store hogi per table.
- **Queue**: `sync_queue` table already exists cloud-side. Local ek mirror queue rakhega jo confirmed sync ke baad clear hoga.
- **Conflict policy**: last-write-wins by `updated_at` for master data; append-only for sales/purchases (no conflict possible since local generates temp id, server assigns final).
- **Auth offline**: Supabase session localStorage mein 1 week rehta hy — us duration mein offline chalega. Session expire ke baad net zaroori.
- **What stays online-only** (turn 1-5 mein bhi): Admin panel, cross-tenant admin RPCs, security center, library approvals, tenant billing — ye by design cloud-only rahenge.
- **Realtime**: offline mode enable hone par realtime subscriptions pause (warna local optimistic writes conflict karenge).

## Limitations user ko batane hain

- Offline mode enable karne ke baad pehla sync bara hoga (saare products/customers pull).
- Multi-device pe same time offline edits hon to last-sync wins — kuch data lose ho sakta hy.
- Reports (analytics), admin panel, aur multi-tenant features **online required** rahenge.
- Session ~7 din baad refresh chahiye — us waqt net honi chahiye.

## Turn 1 deliverable (is turn mein ship hoga)

Sirf:
- POS Reprint dialog mein Review (eye) button.
- Offline foundation files (dexie schema, sync engine skeleton, status hook, badge, Settings toggle).
- `bun add dexie` install.

POS reads/writes ka offline wiring **turn 2** mein karenge — infrastructure pehle solid banao, phir har module wire karo. Isse har turn testable rahega aur bugs contained rahenge.

Approve karo to turn 1 start karta hoon.
