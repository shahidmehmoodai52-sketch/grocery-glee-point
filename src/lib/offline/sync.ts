// Bidirectional sync engine.
//
// Pull  : cloud → IndexedDB, incrementally via an `updated_at`/`created_at`
//         watermark, paginated so shops with 100k+ products mirror fully.
// Push  : IndexedDB queue → cloud, in strict chronological order, with
//         idempotency keys, bounded retries and progress reporting.

import { supabase } from "@/integrations/supabase/client";
import { db, MIRRORED_TABLES, type MirroredTable } from "./db";
import {
  getOfflineStatus, markSyncStart, markSyncDone, markSyncError, refreshPendingCount,
  setSyncProgress,
} from "./status";
import { getDeviceId } from "./device";
import { logPerf, nowMs, timed, whenIdle, yieldToUI } from "./perf";
import { toast } from "sonner";


const PULL_TABLES: MirroredTable[] = [
  "products", "product_barcodes", "customers", "suppliers",
  "store_settings", "user_roles", "cash_accounts", "held_bills",
  "sales", "sale_items", "sale_returns", "sale_return_items",
  "purchases", "purchase_items", "expenses",
];

const PAGE = 1000;
/** Safety ceiling per table per sync pass (products can be huge on first sync). */
const MAX_PAGES = 150; // 150k rows
const MAX_ATTEMPTS = 8;

async function getWatermark(table: string): Promise<string | null> {
  const row = await db()._sync_state.get(table);
  return row?.last_pulled_at ?? null;
}
async function setWatermark(table: string, ts: string) {
  await db()._sync_state.put({ table, last_pulled_at: ts, last_error: null });
}

// Only these tables actually have an `updated_at` column in the cloud schema.
// The rest must fall back to `created_at` for the incremental watermark, otherwise
// PostgREST returns 42703 "column ... does not exist" and the sync fails loudly.
const HAS_UPDATED_AT = new Set<string>(["products", "expenses", "store_settings"]);
/** Tables with neither timestamp usable as a watermark → always full pull (small). */
const FULL_PULL = new Set<string>([
  "store_settings", "user_roles", "cash_accounts",
  "sale_items", "sale_return_items", "purchase_items",
]);

/** Notified with the set of tables whose local mirror actually changed. */
type ChangedListener = (tables: string[]) => void;
const changedListeners = new Set<ChangedListener>();
export function subscribeSyncedTables(l: ChangedListener) {
  changedListeners.add(l);
  return () => { changedListeners.delete(l); };
}

async function pullTable(table: MirroredTable): Promise<number> {
  const since = await getWatermark(table);
  const full = FULL_PULL.has(table);
  const watermarkCol = HAS_UPDATED_AT.has(table) ? "updated_at" : "created_at";
  const orderCol = full ? "id" : watermarkCol;

  let total = 0;
  let maxTs: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabase
      .from(table as any)
      .select("*")
      .order(orderCol, { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (!full && since) q = q.gt(watermarkCol, since);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    await (db() as any)[table].bulkPut(data);
    total += data.length;
    if (!full) {
      const pageMax = data
        .map((r: any) => r.updated_at ?? r.created_at)
        .filter(Boolean)
        .sort()
        .pop();
      if (pageMax && (!maxTs || pageMax > maxTs)) maxTs = pageMax;
    }
    if (data.length < PAGE) break;
    // Give the main thread back between pages so scanning/checkout stay instant.
    await yieldToUI();
  }

  if (maxTs) await setWatermark(table, maxTs);
  return total;
}


/**
 * Flush the queue in chronological order.
 * A failing item aborts the pass so later transactions never overtake earlier
 * ones (inventory maths depends on ordering). Items past MAX_ATTEMPTS are
 * skipped so a single poison record cannot block the whole queue forever.
 */
async function flushQueue(opts: { silent?: boolean } = {}): Promise<{ ok: number; failed: number }> {
  const pending = (await db()._queue.where("status").anyOf(["pending", "failed", "syncing"]).toArray())
    .filter((r) => (r.attempts ?? 0) < MAX_ATTEMPTS)
    .sort((a, b) =>
      a.local_created_at === b.local_created_at
        ? (a.id ?? 0) - (b.id ?? 0)
        : a.local_created_at < b.local_created_at ? -1 : 1,
    );

  let ok = 0, failed = 0;
  const totalItems = pending.length;

  for (const item of pending) {
    if (totalItems > 0 && !opts.silent) setSyncProgress(ok + failed, totalItems);
    try {
      await db()._queue.update(item.id!, { status: "syncing" });
      if (item.op === "rpc") {
        const { error } = await supabase.rpc(item.table as any, item.payload);
        if (error) throw error;
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
      await db()._queue.update(item.id!, { status: "done", last_error: null });
      ok++;
    } catch (e: any) {
      failed++;
      await db()._queue.update(item.id!, {
        status: "failed",
        attempts: (item.attempts ?? 0) + 1,
        last_error: String(e?.message ?? e),
      });
      // Stop the pass: preserve chronological application on the cloud.
      break;
    }
    // Never hold the main thread for a long queue.
    await yieldToUI();
  }
  if (!opts.silent) setSyncProgress(null, null);
  // Prune "done" rows > 7 days old.
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  await db()._queue.where("status").equals("done").and((r) => r.local_created_at < cutoff).delete();
  return { ok, failed };
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

    // 2. Pull master + transactional data in small idle batches, and only when
    //    the previous pull is old enough (reconnect flapping is a no-op).
    const changed: string[] = [];
    const skipPull = nowMs() - lastPullAt < PULL_MIN_GAP_MS && flushResult.ok === 0;
    if (!skipPull) {
      for (let i = 0; i < PULL_TABLES.length; i += PULL_BATCH) {
        await whenIdle(400);
        const batch = PULL_TABLES.slice(i, i + PULL_BATCH);
        for (const t of batch) {
          try {
            const n = await timed(`sync:pull:${t}`, () => pullTable(t));
            if (n > 0) changed.push(t);
            // Mark the local snapshot fresh so the smart data-access layer can
            // serve it on the next cold start without an extra cloud round trip.
            try {
              const { stampFresh } = await import("./data-access");
              await stampFresh(t);
            } catch {/* freshness stamping is best effort */}
          } catch (e: any) {
            await db()._sync_state.put({
              table: t, last_pulled_at: (await getWatermark(t)),
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


/** Enqueue a write for later sync. Returns the local queue id. */
export async function enqueueWrite(item: {
  op: "insert" | "update" | "delete" | "rpc";
  table: string;
  payload: any;
  client_uuid?: string;
}): Promise<number> {
  const id = await db()._queue.add({
    op: item.op,
    table: item.table,
    payload: item.payload,
    client_uuid:
      item.client_uuid ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `q-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    device_id: getDeviceId(),
    local_created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    status: "pending",
  });
  await refreshPendingCount();
  return id as number;
}

/** Wipe local mirror — used on logout or when the active tenant/user changes. */
export async function wipeLocalMirror() {
  for (const t of MIRRORED_TABLES) {
    try { await (db() as any)[t].clear(); } catch {}
  }
  await db()._sync_state.clear();
  await db()._queue.clear();
  await refreshPendingCount();
}
