// Bidirectional sync engine — pulls fresh rows from cloud into IndexedDB,
// then flushes queued local writes back. Called on boot, on manual "Sync now",
// and whenever the browser comes back online.
//
// Turn 1: engine skeleton for master data (products, customers, suppliers,
// store_settings). Extended per-module in later turns.

import { supabase } from "@/integrations/supabase/client";
import { db, MIRRORED_TABLES, type MirroredTable } from "./db";
import {
  getOfflineStatus, markSyncStart, markSyncDone, markSyncError, refreshPendingCount,
} from "./status";

const PULL_TABLES: MirroredTable[] = [
  "products", "product_barcodes", "customers", "suppliers",
  "store_settings", "user_roles", "sales", "sale_items",
];


async function getWatermark(table: string): Promise<string | null> {
  const row = await db()._sync_state.get(table);
  return row?.last_pulled_at ?? null;
}
async function setWatermark(table: string, ts: string) {
  await db()._sync_state.put({ table, last_pulled_at: ts, last_error: null });
}

async function pullTable(table: MirroredTable): Promise<number> {
  const since = await getWatermark(table);
  // store_settings has no updated_at reliably in every project; pull all.
  const useWatermark = table !== "store_settings" && since;
  let q = supabase.from(table as any).select("*").limit(1000);
  if (useWatermark) q = q.gt("updated_at", since);
  const { data, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  if (!data || data.length === 0) return 0;
  await (db() as any)[table].bulkPut(data);
  const maxTs = data
    .map((r: any) => r.updated_at ?? r.created_at)
    .filter(Boolean)
    .sort()
    .pop();
  if (maxTs) await setWatermark(table, maxTs);
  return data.length;
}

async function flushQueue(): Promise<{ ok: number; failed: number }> {
  const pending = await db()._queue.where("status").anyOf(["pending", "failed"]).toArray();
  let ok = 0, failed = 0;
  for (const item of pending) {
    try {
      await db()._queue.update(item.id!, { status: "syncing" });
      if (item.op === "rpc") {
        const { error } = await supabase.rpc(item.table as any, item.payload);
        if (error) throw error;
      } else if (item.op === "insert") {
        const { error } = await supabase.from(item.table as any).insert(item.payload);
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
    }
  }
  // Prune "done" rows > 7 days old.
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  await db()._queue.where("status").equals("done").and((r) => r.local_created_at < cutoff).delete();
  return { ok, failed };
}

let running = false;

export async function runSync(opts: { silent?: boolean } = {}): Promise<void> {
  if (running) return;
  const s = getOfflineStatus();
  if (!s.enabled) return;
  if (!s.online) return;
  running = true;
  if (!opts.silent) markSyncStart();
  try {
    // 1. Push local queue first so cloud sees fresh writes before we overwrite locally.
    await flushQueue();
    // 2. Pull master data.
    for (const t of PULL_TABLES) {
      try { await pullTable(t); }
      catch (e: any) {
        await db()._sync_state.put({
          table: t, last_pulled_at: (await getWatermark(t)),
          last_error: String(e?.message ?? e),
        });
      }
    }
    await refreshPendingCount();
    markSyncDone();
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
}): Promise<number> {
  const id = await db()._queue.add({
    ...item,
    local_created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    status: "pending",
  });
  await refreshPendingCount();
  return id as number;
}

/** Wipe local mirror — used when user disables offline mode or switches tenants. */
export async function wipeLocalMirror() {
  for (const t of MIRRORED_TABLES) {
    try { await (db() as any)[t].clear(); } catch {}
  }
  await db()._sync_state.clear();
  await db()._queue.clear();
  await refreshPendingCount();
}
