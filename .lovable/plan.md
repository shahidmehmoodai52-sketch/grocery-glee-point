# Tillix Performance Audit (read-only)

No project or database changes were made. Findings only.

## 1. Overall verdict

The database is **not** the constraint at current volume (123 MB total, largest table 37k rows, disk 22%, connections 21/60). The pain comes from three things, in order:

1. The **offline sync engine** re-downloads whole tables in a loop and is by far the largest generator of database work in production statistics.
2. **Reports / ledgers / intelligence screens** still pull full history to the browser and aggregate in JavaScript.
3. **RLS policies + duplicate indexes** make cheap queries repeatedly more expensive than they need to be, and slow down every POS write.

Verdict: *slow but fixable without re-architecting*. Roughly 70% of the win is in sync + 4 screens + 3 database hygiene items.

Data volumes (confirmed): inventory_movements 37,621 · sale_items 32,478 · product_barcodes 21,846 · products 20,464 · audit_logs 18,375 · sales 13,377 · everything else < 3,000 rows.

## 2. Ranked bottlenecks

### CRITICAL

**C1 — Offline sync full-table pulls dominate all database load.**
`src/lib/offline/sync.ts:19-50` pulls 15 tables, 6 of them wholesale (`store_settings, user_roles, cash_accounts, sale_items, sale_return_items, purchase_items`) every 20 min, 1000 rows/page, 500-page cap. Production statistics confirm the cost: unfiltered paged `SELECT products.* ORDER BY updated_at` = **263,101 calls / 4,310 s cumulative / 4.2 s worst case**; `sales.*` = 156,139 calls / 1,617 s; `product_barcodes.*` = 156,944 calls / 1,331 s. Together these four patterns are ~60% of all recorded database time. Triggered from boot, reconnect, every 5 min, and every tab visibility change (`src/routes/__root.tsx:190-216`). Affects: everything — it competes with POS checkout for the same connections.

**C2 — No index backing the sync sort order.**
`products` has 13 indexes but **none on `updated_at`**; `product_barcodes` has none on `created_at`. Every one of the 263k product pulls sorts 20k rows unindexed (16 ms mean). Confirmed by `pg_indexes`.

**C3 — Reports fetches all history twice and aggregates client-side.**
`src/routes/_authenticated/reports.tsx:454-500` `fetchAll`s sales+nested items, returns+items, purchases and the whole product table for the range; default preset is `"all"` (line 358). Lines 425-529 fetch the *same* tables again paged for the list tabs. Lines 651-733 then run `Map`/`reduce` passes over the full arrays on every date change. No `staleTime`, so every tab return refetches. Affects: Reports, Supplier-wise report.

### HIGH

**H1 — Per-row RLS evaluation on hot tables.** `customers`, `cash_accounts`, `cash_transactions`, `inventory_movements` policies call `current_tenant_id()` **unwrapped**, and `current_tenant_id()` is `plpgsql STABLE` (not inlinable, `src` confirmed). Symptom: `cash_accounts` shows **3.6M sequential scans / 54M tuples read for 15 rows**; `customers` 501k scans / 41M tuples for 88 rows; `sale_return_items` 135k scans with `idx_scan = 0`. `products`/`sales`/`sale_items` already use the correct `(SELECT current_tenant_id())` form — the fix pattern exists in the project, it just wasn't applied everywhere. Additionally **20 tables have more than one SELECT policy** (e.g. `customers` has both `customers_select_auth` and `tenant_isolation_select`), doubling the evaluation.

**H2 — POS loads the whole catalogue client-side.** `pos.tsx:798-849` `fetchAll`s all products *and* all `product_barcodes` (42k rows combined) every 5 min per till, then scores the full list per keystroke (`pos.tsx:962-993`). `pos.tsx:874-878` loops library barcode chunks with **sequential** awaits.

**H3 — Customers ledger is unbounded.** `customers.index.tsx:103-119` `fetchAll`s all sales, all payments, all returns with no date filter just to show balances in a list. Note the mirror screen `suppliers.$id.tsx:67-84` already uses a `get_supplier_ledger` RPC — customers never got the same treatment.

**H4 — XLSX in the shared authenticated layout.** `_authenticated/route.tsx:22` statically imports `@/lib/backup`, which imports SheetJS (`backup.ts:2`). Every authenticated page, including POS, pays for it. Also `i18n` eagerly imports **all 6 locales, 686 KB of raw JSON**, synchronously, on every route including the public landing page (`src/lib/i18n.ts:6-11`, `src/start.ts:1`).

### MEDIUM

**M1 — Write amplification on POS checkout.** Duplicate/redundant indexes: `sales` has `sales_tenant_created_idx` *and* `idx_sales_tenant_created` (identical), plus 3 overlapping tenant+invoice indexes; `products` has `products_tenant_sku_idx` + `idx_products_sku_tenant` + `products_tenant_sku_uniq`, and barcode duplicated the same way; `cash_transactions` has 5 overlapping tenant/date indexes. Every insert maintains all of them. On top of that `sale_items` fires **4 triggers** per row (movement, undo-movement, FEFO batch consumption, fill_tenant) and `products` fires **5**, including two near-identical global-library contribution triggers (`auto_contribute_global_product`, `contribute_new_product_to_library`).

**M2 — `user_sessions` heartbeat.** 30 s upsert (`use-session-heartbeat.ts:39`) = **83,866 calls / 327 s** of database time for presence data.

**M3 — Unbounded `fetchAll` on secondary screens.** `intelligence.tsx:115-136,374-377`, `operations.tsx:489-985` (6 sub-tabs each fetching a full table with `select("*")`), `sale-returns.tsx:130-172`, `purchase-returns.tsx:105-115`.

**M4 — `sales.tsx` truncates at 1000 rows** (`sales.tsx:87-97`, `select("*, customers(name), sale_items(*)")`) and recomputes totals with `reduce` (119-145) instead of the existing `get_reports_summary` RPC. Correctness *and* performance.

**M5 — 111,425 rolled-back transactions since boot.** Something is failing writes at volume — most likely an `enforce_*` trigger or an RLS insert denial in the sync flush path. Cause not identified; worth a dedicated investigation.

### LOW

**L1** — Realtime: 36 tables on one channel, a single `products` event invalidates 13 query keys (`use-realtime-sync.ts:8-88`); already coalesced at 600 ms + `refetchType: "active"`.
**L2** — Four always-on timers per tab: 15 s connectivity HEAD probe (`status.ts:151`), 30 s heartbeat, 60 s backup check, 5 min sync; plus `admin.tsx:170-190` polls two RPCs every 30 s.
**L3** — `usePermissions` fires 4 queries gating every `RouteGuard` transition (`use-permissions.ts:34-56`) — flash of blank, not blocked paint.
**L4** — `dashboard.tsx` fires 7 RPCs in parallel per range change; each is cheap and RPC-backed. Dashboard is otherwise the best-optimised screen.
**L5** — No virtualization on large tables (reports, intelligence, POS results). Likely, not confirmed — needs a render profile.

## 3. Breakdown by layer

- **Database/SQL: ~45%** — driven by C1/C2 volume and H1 RLS per-row cost. The schema itself is well indexed for tenant+date reads.
- **Frontend JS: ~25%** — C3, H2, H3, M3 client aggregation and 686 KB i18n + SheetJS parse.
- **Network: ~20%** — full-table paging round trips, 4-5 queries per POS keystroke, polling timers.
- **Offline/sync: overlapping ~30%** of the above; it is the single largest amplifier rather than a separate layer.

## 4. Quick wins vs structural (recommendations only)

Quick wins: add `products(tenant_id, updated_at)` and `product_barcodes(tenant_id, created_at)` indexes; wrap `current_tenant_id()` in `(SELECT …)` on the four remaining tables and drop the duplicate SELECT policies; drop the duplicate indexes; dynamic-import `@/lib/backup`; lazy-load locales; add `staleTime` to reports/sales/intelligence queries; raise the heartbeat to 2-5 min and the probe to 60 s.

Structural: move `sale_items`/`purchase_items`/`sale_return_items` off `FULL_PULL` to watermark-incremental; replace Reports client aggregation with the existing RPC pattern and delete the duplicate paged+full fetches; give customers a `get_customer_ledger` RPC mirroring suppliers; server-side search for POS instead of a full in-memory catalogue; consolidate the two products library-contribution triggers.

## 5. Prioritised roadmap (not implemented)

1. Indexes C2 + duplicate-index cleanup + RLS `(SELECT …)` fix and duplicate-policy removal. Lowest risk, largest measured effect.
2. Sync: drop line-item tables from `FULL_PULL`; widen the full-pull gap. Needs a Supabase branch test per the project's staging rule.
3. Reports: delete the duplicate full fetches, move aggregation to RPC, add `staleTime`.
4. Customers ledger RPC; `sales.tsx` totals via RPC and real pagination.
5. Bundle: dynamic backup import, per-locale i18n.
6. POS server-side search; then intelligence/operations pagination.
7. Investigate M5 (rolled-back transactions) and M2 heartbeat cadence.

## 6. Prior plans — still open vs done

- `performance-audit-optimization-plan-2026-08-18`: supplier ledger RPC **done**; dashboard aggregate RPCs **done**; reports pagination **not done — deliberately reversed** by `performance-and-data-integrity-restoration-plan-2026-08-19`, which replaced `.range(0,999)` with `fetchAll` for correctness. C3 is therefore a *known trade-off*, not an oversight: the fix is an aggregate RPC, not re-truncation. Supplier list balance caching **not done**. Master-data `staleTime` **partially done** (POS 5 min, master-sync 10 min gap).
- `production-data-audit-fix-plan-2026-08-15`: `sales(tenant_id, created_at)` and `expenses(tenant_id, created_at)` indexes **done** (twice over — hence M1).

## 7. Confidence

Confirmed from production statistics or schema: C1, C2, H1, M1, M2, M5, and all row counts. Confirmed from code: C3, H2, H3, H4, M3, M4, L1-L4. Likely, unverified: L5 (needs a render profile), exact chunk sizes (needs a build inspection), and the percentage split in section 3, which is an estimate from `pg_stat_statements` totals plus code reading, not browser telemetry. No runtime browser telemetry was collected.

**No project files or database objects were modified, created, or deleted during this audit. No write SQL was executed.**
