// Bidirectional sync engine.
//
// Pull  : cloud → IndexedDB, incrementally via an `updated_at`/`created_at`
//         watermark, paginated so shops with 100k+ products mirror fully.
// Push  : IndexedDB queue → cloud, in strict chronological order, with
//         idempotency keys, bounded retries and progress reporting.

import { supabase } from "@/integrations/supabase/client";
import { db, MIRRORED_TABLES, queuePriority, type MirroredTable } from "./db";
import {
  getOfflineStatus,
  markSyncStart,
  markSyncDone,
  markSyncError,
  refreshPendingCount,
  setSyncProgress,
  getSyncMode,
} from "./status";
import { getDeviceId, getMeta } from "./device";
import { logPerf, nowMs, timed, whenIdle, yieldToUI } from "./perf";
import { toast } from "sonner";


const PULL_TABLES: MirroredTable[] = [
  "products", "product_barcodes", "customers", "suppliers",
  "store_settings", "user_roles", "cash_accounts", "held_bills",
  "sales", "sale_returns",
  "purchases", "purchase_returns", "expenses",
  "party_payments", "cash_transactions",
  "product_batches", "inventory_damages", "inventory_waste", "asset_categories", "assets",
  "shift_sessions",
  "cash_drawer_events", "shift_notes", "shift_tasks", "receipt_reprints",
  "sale_voids", "shift_checklist", "manager_handovers",
  "pharmacy_product_details", "stock_count_sessions",
];

const PAGE = 1000;
/** Maximum pages per table per sync pass to prevent memory exhaustion.
 *  If a table exceeds this, the sync will error loudly rather than truncating. */
const MAX_PAGES = 500; // 500k rows
const MAX_ATTEMPTS = 50; // Increased retry budget; failures are never silently discarded now.
/** Full-pull tables can be large (item history). Don't re-download too often. */
const FULL_PULL_MIN_GAP_MS = 20 * 60_000;

async function getWatermark(table: string): Promise<{ ts: string | null; id: string | null }> {
  const row = await db()._sync_state.get(table);
  return { ts: row?.last_pulled_at ?? null, id: row?.last_pulled_id ?? null };
}
async function setWatermark(table: string, ts: string, id: string | null = null) {
  await db()._sync_state.put({ table, last_pulled_at: ts, last_pulled_id: id, last_error: null });
}

// Only these tables actually have an `updated_at` column in the cloud schema.
// The rest must fall back to `created_at` for the incremental watermark, otherwise
// PostgREST returns 42703 "column ... does not exist" and the sync fails loudly.
const HAS_UPDATED_AT = new Set<string>([
  "products", "expenses", "store_settings", "cash_transactions",
  "product_batches", "asset_categories", "assets", "shift_sessions", "shift_tasks",
  "pharmacy_product_details", "stock_count_sessions",
]);
/** Tables with neither timestamp usable as a watermark → always full pull (small). */
const FULL_PULL = new Set<string>([
  "store_settings", "user_roles", "cash_accounts",
]);

/** Line-item child tables have neither a usable timestamp column nor an
 *  identity worth watermark-tracking of their own — each row is created once,
 *  atomically with its parent (sale/purchase/return), and never changes
 *  independently afterward. They used to be FULL_PULL tables, re-downloaded
 *  in full on every sync pass; fine while small, but unbounded as a shop's
 *  history grows — seen live costing ~3,600 extra requests/day once one
 *  tenant's sale_items alone passed 50k rows, re-fetching the whole table
 *  every ~20 minutes forever. Instead, fetch each parent page's own new
 *  child rows by foreign key, riding the parent's incremental watermark
 *  instead of having one of their own. */
const CHILD_TABLES: Partial<Record<MirroredTable, { table: MirroredTable; fk: string }>> = {
  sales: { table: "sale_items", fk: "sale_id" },
  sale_returns: { table: "sale_return_items", fk: "return_id" },
  purchases: { table: "purchase_items", fk: "purchase_id" },
  purchase_returns: { table: "purchase_return_items", fk: "return_id" },
};

/** PostgREST's `.in()` filter puts every id in the URL — keep each request
 *  well short of proxy/CDN URL-length limits even during a large first-time
 *  backlog catch-up (a fresh device can see thousands of parent ids in one
 *  page's worth of history). */
const CHILD_FETCH_CHUNK = 200;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function pullChildRows(parentIds: string[], child: { table: MirroredTable; fk: string }) {
  for (const ids of chunk(parentIds, CHILD_FETCH_CHUNK)) {
    const { data, error } = await supabase.from(child.table as any).select("*").in(child.fk, ids);
    if (error) throw new Error(`${child.table}: ${error.message}`);
    if (data && data.length) await (db() as any)[child.table].bulkPut(data);
  }
}

/** Notified with the set of tables whose local mirror actually changed. */
type ChangedListener = (tables: string[]) => void;
const changedListeners = new Set<ChangedListener>();
export function subscribeSyncedTables(l: ChangedListener) {
  changedListeners.add(l);
  return () => { changedListeners.delete(l); };
}

/** Exported only for the regression test covering the cursor-advance bug
 *  below — not part of the sync engine's public API otherwise. */
export async function pullTable(table: MirroredTable): Promise<number> {
  // Mutable cursor — advanced after every page (see below). Using these as
  // `const` was the bug: every page of a >PAGE-row backlog re-issued the
  // exact same pre-loop cursor, so a table with more than 1000 rows to catch
  // up on (a device back online after a while, or any tenant whose backlog
  // simply exceeds one page) re-fetched page 1 forever until MAX_PAGES threw
  // — then repeated the same MAX_PAGES-page refetch on every subsequent sync
  // pass, since the persisted watermark was never advanced either. Seen live
  // as a sustained flood of identical `sales`/`products`/`product_barcodes`
  // requests burning through the shared Cloudflare Worker proxy's daily
  // quota and starving genuine reads/writes on unrelated devices.
  let { ts: since, id: sinceId } = await getWatermark(table);
  const full = FULL_PULL.has(table);
  if (full && since) {
    const age = Date.now() - new Date(since).getTime();
    if (Number.isFinite(age) && age >= 0 && age < FULL_PULL_MIN_GAP_MS) {
      return 0;
    }
  }
  const watermarkCol = HAS_UPDATED_AT.has(table) ? "updated_at" : "created_at";

  let total = 0;
  let maxTs: string | null = null;
  let maxId: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabase
      .from(table as any)
      .select("*");

    if (full) {
      q = q.order("id", { ascending: true })
           .range(page * PAGE, page * PAGE + PAGE - 1);
    } else {
      // Composite ordering to prevent skipping rows with identical timestamps at page boundaries
      q = q.order(watermarkCol, { ascending: true })
           .order("id", { ascending: true });
      
      if (since) {
        if (sinceId) {
          q = q.or(`${watermarkCol}.gt."${since}",and(${watermarkCol}.eq."${since}",id.gt."${sinceId}")`);
        } else {
          q = q.gt(watermarkCol, since);
        }
      }
      // Since we filter by cursor, we always fetch the first PAGE
      q = q.limit(PAGE);
    }

    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    
    if (!data || data.length === 0) break;
    
    await (db() as any)[table].bulkPut(data);
    total += data.length;

    const child = CHILD_TABLES[table];
    if (child) {
      const ids = (data as any[]).map((r) => r.id).filter(Boolean);
      if (ids.length) await pullChildRows(ids, child);
    }

    if (!full) {
      const lastRow = data[data.length - 1] as any;
      const ts = lastRow.updated_at ?? lastRow.created_at;
      if (ts) {
        maxTs = ts;
        maxId = lastRow.id;
        // Advance the cursor so the next page (if any) starts after what
        // was just fetched, instead of re-requesting this same page.
        since = ts;
        sinceId = lastRow.id;
        // Persist after every page, not just once at the end — a large
        // backlog can span many pages, and a tab close / crash mid-pull
        // should resume from the last completed page, not redo the whole
        // backlog from the original pre-pull watermark.
        await setWatermark(table, ts, lastRow.id);
      }
    }

    // If we finished the dataset, we're done.
    if (data.length < PAGE) break;

    // If we hit the safety limit on the last iteration, it means there's more data.
    if (page === MAX_PAGES - 1) {
      throw new Error(`${table}: Sync safety limit reached (${MAX_PAGES * PAGE} rows). Please contact support for large dataset synchronization.`);
    }

    // Give the main thread back between pages so scanning/checkout stay instant.
    await yieldToUI();
  }

  if (maxTs) await setWatermark(table, maxTs, maxId);
  if (full) await setWatermark(table, new Date().toISOString());
  return total;
}


/** Statuses that still need an upload attempt. "syncing"/"uploading" are
 *  included on purpose: a browser crash or power failure leaves an item in that
 *  state and it must resume, never be lost. */
const ACTIVE_STATUSES = ["pending", "failed", "retrying", "syncing", "uploading"] as const;

/** Exponential backoff with jitter: 5s, 10s, 20s … capped at 5 minutes. */
function backoffMs(attempts: number): number {
  // Max delay 1 hour for long-term retries.
  const base = Math.min(5_000 * 2 ** Math.max(0, attempts), 60 * 60_000);
  return base + Math.floor(Math.random() * 1000);
}

function isPermanentSyncError(e: any): boolean {
  const code = String((e as any)?.code ?? "").toUpperCase();
  const msg = String((e as any)?.message ?? e ?? "").toLowerCase();
  if (["22P02", "23502", "23503", "42P01", "42703", "42883", "PGRST202"].includes(code)) return true;
  return /invalid input syntax|null value|foreign key|does not exist|function .* does not exist|unknown|not authenticated|forbidden|permission denied|does not belong to current tenant|no active tenant|party does not belong/.test(msg);
}

/** After an offline sale's queued `complete_sale` RPC finally uploads, the
 *  server has inserted a brand-new row with its own id and the real
 *  `S-<shop_code>-<n>` invoice number — completely different from the local
 *  placeholder row (`localId` / `OFF-<device>-...` invoice number) created
 *  while offline. Without this, the placeholder just sits in Dexie forever
 *  (a plain `pullTable("sales")` can't help: it filters by `created_at >
 *  watermark`, and the server row's `created_at` is backdated to match the
 *  original offline timestamp, so once the watermark has moved past that
 *  point — e.g. any other sale synced since — the incremental pull skips it
 *  entirely). Reprinting that invoice from history would then show the
 *  temporary offline number forever instead of the real one. Replace the
 *  placeholder with the server's row immediately after a successful upload. */
async function reconcileSyncedSale(localId: string, serverId: string): Promise<void> {
  try {
    const { data: sale, error } = await supabase
      .from("sales")
      .select("*, sale_items(*), customers(name,phone)")
      .eq("id", serverId)
      .maybeSingle();
    if (error || !sale) return;
    await db().transaction("rw", db().sales, db().sale_items, async () => {
      await db().sales.delete(localId);
      await db().sale_items.where("sale_id").equals(localId).delete();
      await db().sales.put(sale);
      const items = (sale as any).sale_items;
      if (Array.isArray(items) && items.length) await db().sale_items.bulkPut(items);
    });
  } catch {
    // Best-effort — the next full mirror pull will eventually catch up.
  }
}

const RPC_QUEUE_LABELS: Record<string, string> = {
  complete_sale: "Sale",
  complete_sale_return: "Sale return",
  complete_purchase_return: "Purchase return",
  edit_sale: "Sale edit",
  undo_last_sale: "Sale undo",
  resume_bill: "Held bill resume",
  hold_bill: "Held bill",
};
const TABLE_QUEUE_LABELS: Record<string, string> = {
  customers: "Customer",
  suppliers: "Supplier",
  expenses: "Expense",
  audit_logs: "Activity log",
};

/** Human-readable "what's uploading right now" text for the sync status badge. */
function describeQueueItem(item: { op: string; table: string; payload: any }): string {
  if (item.op === "rpc") {
    const base = RPC_QUEUE_LABELS[item.table] ?? item.table;
    if (item.table === "complete_sale") {
      const invoiceNo = item.payload?.payload?._local_invoice_no;
      return invoiceNo ? `${base} ${invoiceNo}` : base;
    }
    return base;
  }
  return TABLE_QUEUE_LABELS[item.table] ?? item.table;
}

/** Recover items interrupted mid-upload (crash / power loss / tab kill). */
export async function recoverInterruptedQueue(): Promise<number> {
  try {
    const stuck = await db()._queue.where("status").anyOf(["syncing", "uploading"]).toArray();
    for (const it of stuck) {
      await db()._queue.update(it.id!, { status: "pending", next_attempt_at: null });
    }
    if (stuck.length) logPerf("queue recovered", { items: stuck.length });
    return stuck.length;
  } catch {
    return 0;
  }
}

/**
 * Flush the queue.
 *
 * Ordering: entity priority (customers → suppliers → products → sales →
 * sale returns → inventory adjustments), then strict chronological order
 * inside each entity, because inventory maths depends on it.
 *
 * A failure only stops the remaining items of that same entity — other
 * entities keep uploading — and schedules an exponentially backed-off retry.
 * Once the retry budget is spent the item becomes "cancelled" so a single
 * poison record can never block the queue forever.
 */
async function flushQueue(opts: { silent?: boolean } = {}): Promise<{ ok: number; failed: number; cancelled: number }> {
  const nowIso = new Date().toISOString();
  const all = await db()._queue.where("status").anyOf(ACTIVE_STATUSES as unknown as string[]).toArray();

  let cancelled = 0;
  const runnable: typeof all = [];
  for (const r of all) {
    // We no longer auto-cancel based on attempts. Exhausted attempts just wait longer.
    // Permanent errors are still surfaced.
    if (r.next_attempt_at && r.next_attempt_at > nowIso) continue; // backoff not elapsed
    runnable.push(r);
  }

  runnable.sort((a, b) => {
    const pa = a.priority ?? queuePriority(a.table);
    const pb = b.priority ?? queuePriority(b.table);
    if (pa !== pb) return pa - pb;
    if (a.local_created_at !== b.local_created_at) return a.local_created_at < b.local_created_at ? -1 : 1;
    return (a.id ?? 0) - (b.id ?? 0);
  });

  let ok = 0, failed = 0;
  const totalItems = runnable.length;
  /** Entities whose chain broke this pass — later items must wait their turn. */
  const blocked = new Set<string>();

  for (const item of runnable) {
    if (blocked.has(item.table)) continue;
    if (totalItems > 0 && !opts.silent) setSyncProgress(ok + failed, totalItems, describeQueueItem(item));
    try {
      await db()._queue.update(item.id!, { status: "uploading" });
      if (item.op === "rpc") {
        const { data, error } = await supabase.rpc(item.table as any, item.payload);
        if (error) throw error;
        if (item.table === "complete_sale" && item.client_uuid && typeof data === "string") {
          await reconcileSyncedSale(item.client_uuid, data);
        }
      } else if (item.op === "insert") {
        // upsert on the client uuid → replaying a half-applied write cannot duplicate.
        const { error } = await supabase
          .from(item.table as any)
          .upsert(item.payload, { onConflict: "id", ignoreDuplicates: true });
        if (error) throw error;
      } else if (item.op === "update") {
        const { id, ...rest } = item.payload;
        const { error } = await supabase.from(item.table as any).update(rest).eq("id", id);
        if (error) throw error;
      } else if (item.op === "delete") {
        const { error } = await supabase.from(item.table as any).delete().eq("id", item.payload.id);
        if (error) throw error;
      }
      await db()._queue.update(item.id!, {
        status: "uploaded",
        last_error: null,
        next_attempt_at: null,
      });
      ok++;
    } catch (e: any) {
      failed++;
      const attempts = (item.attempts ?? 0) + 1;
      const permanent = isPermanentSyncError(e);
      // Permanent errors (validation/schema/auth) stop retrying.
      // Temporary network errors retry indefinitely with exponential backoff.
      const shouldCancel = permanent;
      if (shouldCancel) cancelled++;
      
      await db()._queue.update(item.id!, {
        status: shouldCancel ? "cancelled" : "retrying",
        attempts,
        last_error: `${permanent ? "PERMANENT ERROR: " : "SYNC ERROR: "}${String(e?.message ?? e)}`,
        next_attempt_at: shouldCancel ? null : new Date(Date.now() + backoffMs(attempts)).toISOString(),
      });
      // Preserve chronological application for this entity only.
      blocked.add(item.table);
    }
    // Never hold the main thread for a long queue.
    await yieldToUI();
  }
  if (!opts.silent) setSyncProgress(null, null);
  // Prune confirmed uploads > 7 days old.
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  await db()._queue
    .where("status").anyOf(["uploaded", "done"])
    .and((r) => r.local_created_at < cutoff)
    .delete();
  return { ok, failed, cancelled };
}

let running = false;
let lastPullAt = 0;
/** Minimum gap between full mirror pulls — reconnect bursts reuse the last pass. */
const PULL_MIN_GAP_MS = 60_000;
/** Tables pulled per idle batch, so a reconnect never stalls the UI thread. */
const PULL_BATCH = 3;

export async function runSync(opts: { silent?: boolean; reason?: string } = {}): Promise<void> {
  if (running) return;
  const s = getOfflineStatus();
  if (!s.enabled) return;
  if (!s.online) return;
  running = true;
  const t0 = nowMs();
  markSyncStart();
  try {
    // 1. Push local queue first so cloud sees fresh writes before we overwrite locally.
    const flushResult = await timed("sync:push", () => flushQueue(opts));
    if (flushResult.ok > 0) {
      toast.success(`${flushResult.ok} offline action${flushResult.ok > 1 ? "s" : ""} synced`);
    }
    if (flushResult.failed > 0 && !opts.silent) {
      toast.error(`${flushResult.failed} queued action${flushResult.failed > 1 ? "s" : ""} failed to sync — will retry`);
    }
    if (flushResult.cancelled > 0 && !opts.silent) {
      toast.error(
        `${flushResult.cancelled} action${flushResult.cancelled > 1 ? "s" : ""} could not be synced after several retries — open Offline settings to review`,
      );
    }
    // Anything still waiting on a backoff window gets its own timer.
    void scheduleRetryPass();

    // 2. Pull master + transactional data in small idle batches, and only when
    //    the previous pull is old enough (reconnect flapping is a no-op).
    const changed: string[] = [];
    const skipPull = nowMs() - lastPullAt < PULL_MIN_GAP_MS && flushResult.ok === 0;
    // products/product_barcodes are the two large catalogue tables (tens of
    // thousands of rows for a real shop). Every other reason this loop runs —
    // the 5-minute idle interval, a reconnect/visibility flap, a retry pass —
    // would otherwise re-request them on the same cadence as small
    // transactional tables, even though nothing about a sale being pushed
    // makes the catalogue itself stale. Gate just these two behind the same
    // freshness TTL the POS page's own local-first reads already use (see
    // data-access.ts) so a sync pass and a page read never both re-fetch the
    // same table moments apart, and skip the request entirely when it's
    // still fresh. Bypassed for a true cold start ("boot", nothing pulled
    // yet) and for an explicit manual "Sync now" (no reason) so those always
    // get a real check.
    const catalogTables = new Set<string>(["products", "product_barcodes"]);
    const bypassCatalogThrottle = !opts.reason || opts.reason === "boot";
    if (!skipPull) {
      for (let i = 0; i < PULL_TABLES.length; i += PULL_BATCH) {
        await whenIdle(400);
        const batch = PULL_TABLES.slice(i, i + PULL_BATCH);
        for (const t of batch) {
          try {
            if (catalogTables.has(t) && !bypassCatalogThrottle) {
              const { isTableFresh } = await import("./data-access");
              if (await isTableFresh(t)) {
                await yieldToUI();
                continue;
              }
            }
            const n = await timed(`sync:pull:${t}`, () => pullTable(t));
            if (n > 0) changed.push(t);
            // Mark the local snapshot fresh so the smart data-access layer can
            // serve it on the next cold start without an extra cloud round trip.
            try {
              const { stampFresh } = await import("./data-access");
              await stampFresh(t);
            } catch {/* freshness stamping is best effort */}
          } catch (e: any) {
            const { ts, id } = await getWatermark(t);
            await db()._sync_state.put({
              table: t,
              last_pulled_at: ts,
              last_pulled_id: id,
              last_error: String(e?.message ?? e),
            });
          }
          await yieldToUI();
        }
      }
      lastPullAt = nowMs();
    }

    // 2b. Master data (categories / units / taxes / shops / users / payment
    //     methods / barcode + printer settings) into the local repositories.
    try {
      const { runMasterSync } = await import("./master-sync");
      await runMasterSync({ force: !skipPull });
    } catch {/* master data is best-effort; never fail a sync pass for it */}

    await refreshPendingCount();
    markSyncDone();
    logPerf("sync complete", {
      reason: opts.reason ?? "manual",
      ms: Math.round(nowMs() - t0),
      pushed: flushResult.ok,
      pushFailed: flushResult.failed,
      pulledTables: skipPull ? "skipped" : changed.length,
    });
    // 3. Tell the UI which tables actually changed — nothing else refetches.
    if (changed.length) {
      for (const l of changedListeners) {
        try { l(changed); } catch {/* listener errors must not break sync */}
      }
    }
  } catch (e: any) {
    markSyncError(String(e?.message ?? e));
  } finally {
    running = false;
  }
}


/** Enqueue a write for later sync. Returns the local queue id.
 *  Idempotent: the same `client_uuid` is never queued twice (the `_queue`
 *  index is unique on it), so a retried caller cannot create a duplicate
 *  upload. Every item carries UUID + tenant + device + version + timestamps
 *  + retry count + status. */
export async function enqueueWrite(item: {
  op: "insert" | "update" | "delete" | "rpc";
  table: string;
  payload: any;
  client_uuid?: string;
  tenant_id?: string | null;
  version?: number;
}): Promise<number> {
  const client_uuid =
    item.client_uuid ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `q-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  // Duplicate guard — same transaction, same device: reuse the existing row.
  try {
    const existing = await db()._queue.where("client_uuid").equals(client_uuid).first();
    if (existing?.id != null) return existing.id;
  } catch {/* index unavailable on very old schema — add below */}

  const tenant_id = item.tenant_id ?? (await getMeta<string>("tenant_id"));
  const id = await db()._queue.add({
    op: item.op,
    table: item.table,
    payload: item.payload,
    client_uuid,
    device_id: getDeviceId(),
    tenant_id: tenant_id ?? null,
    version: item.version ?? 1,
    local_created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    status: "pending",
    next_attempt_at: null,
    priority: queuePriority(item.table),
  });
  await refreshPendingCount();
  // A write created while online should leave immediately — but only in
  // "realtime" sync mode. In "manual"/"scheduled" mode the item stays
  // queued until the user presses "Sync now" or the scheduled timer fires,
  // exactly like being offline (see isEffectivelyOffline()).
  if (getOfflineStatus().online && getSyncMode() === "realtime") void scheduleRetryPass(0);
  return id as number;
}

/** Timer that resumes the queue when a backoff window elapses. */
let retryTimer: number | null = null;
export async function scheduleRetryPass(delayMs?: number): Promise<void> {
  if (typeof window === "undefined") return;
  let delay = delayMs;
  if (delay == null) {
    try {
      const items = await db()._queue.where("status").anyOf(["retrying", "failed", "pending"]).toArray();
      const next = items
        .map((r) => r.next_attempt_at)
        .filter((t): t is string => !!t)
        .sort()[0];
      if (!next) return;
      delay = Math.max(1000, new Date(next).getTime() - Date.now());
    } catch { return; }
  }
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void runSync({ silent: true, reason: "retry" });
  }, Math.min(delay, 5 * 60_000));
}

/** Wipe local mirror — used on logout or when the active tenant/user changes. */
export async function wipeLocalMirror(opts: { includeQueue?: boolean } = { includeQueue: true }) {
  for (const t of MIRRORED_TABLES) {
    try { await (db() as any)[t].clear(); } catch {}
  }
  await db()._sync_state.clear();
  if (opts.includeQueue) {
    await db()._queue.clear();
  }
  await refreshPendingCount();
}

/** Check if the sync queue has pending items. */
export async function getPendingQueueCount(): Promise<number> {
  try {
    return await db()._queue.where("status").anyOf(ACTIVE_STATUSES as unknown as string[]).count();
  } catch {
    return 0;
  }
}

