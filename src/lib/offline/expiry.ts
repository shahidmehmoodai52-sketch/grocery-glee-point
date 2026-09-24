// Offline-aware batch creation + damage/waste recording (expiry.tsx).
//
// Online  : calls create_product_batch / record_damage / record_waste
//           exactly as before.
// Offline : writes the equivalent local row (product_batches /
//           inventory_damages / inventory_waste), applies the same stock
//           (and batch qty_remaining) adjustment the RPC would have made,
//           and queues the RPC for replay — mirroring
//           completePurchaseOfflineAware's pattern.
//
// `product_batch_status`'s computed columns (days_remaining, expiry_status)
// are date-relative and would go stale in a local cache, so they're never
// stored here — expiry.tsx recomputes them from the mirrored
// `product_batches` rows + store_settings at read time instead.

import { supabase } from "@/integrations/supabase/client";
import { db } from "./db";
import { getOfflineStatus } from "./status";
import { enqueueWrite } from "./sync";
import { getDeviceId, getMeta } from "./device";

function isOffline() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

function isNetworkError(e: any): boolean {
  const msg = String(e?.message ?? e ?? "").toLowerCase();
  if (!msg) return false;
  return /failed to fetch|network(error)?|fetch failed|load failed|timeout|timed out|offline|dns|err_(internet|network|name_not_resolved|connection)|socket|aborted|econn|enotfound/.test(
    msg,
  );
}

function uuid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface BatchPayload {
  product_id: string;
  batch_no: string | null;
  qty: number;
  expiry_date: string | null;
  mfg_date: string | null;
  unit_cost: number | null;
  supplier_id: string | null;
  note: string | null;
}

export async function createBatchOfflineAware(payload: BatchPayload): Promise<{ offline: boolean }> {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;

  const rpcPayload = {
    _product_id: payload.product_id,
    _batch_no: payload.batch_no,
    _qty: payload.qty,
    _expiry_date: payload.expiry_date,
    _mfg_date: payload.mfg_date,
    _unit_cost: payload.unit_cost,
    _supplier_id: payload.supplier_id,
    _note: payload.note,
  };

  if (!offline) {
    try {
      const { error } = await supabase.rpc("create_product_batch" as any, rpcPayload as any);
      if (error) throw error;
      return { offline: false };
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const id = uuid();
  const now = new Date().toISOString();
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;
  const device_id = getDeviceId();

  await db().product_batches.put({
    id,
    tenant_id,
    product_id: payload.product_id,
    batch_no: payload.batch_no,
    purchase_date: now.slice(0, 10),
    expiry_date: payload.expiry_date,
    mfg_date: payload.mfg_date,
    qty_initial: payload.qty,
    qty_remaining: payload.qty,
    unit_cost: payload.unit_cost,
    supplier_id: payload.supplier_id,
    purchase_id: null,
    status: "active",
    note: payload.note,
    created_at: now,
    updated_at: now,
    _sync: "pending",
    _offline_pending: true,
    _device_id: device_id,
  });

  await enqueueWrite({ op: "rpc", table: "create_product_batch", tenant_id, payload: rpcPayload });

  return { offline: true };
}

export interface DisposalPayload {
  product_id: string;
  qty: number;
  /** damage_type or waste_type value (e.g. "broken", "expired"). */
  type: string;
  batch_id: string | null;
  reason: string | null;
  note: string | null;
}

async function recordDisposalOfflineAware(
  mode: "damage" | "waste",
  payload: DisposalPayload,
): Promise<{ offline: boolean }> {
  const rpcName = mode === "damage" ? "record_damage" : "record_waste";
  const typeParam = mode === "damage" ? "_damage_type" : "_waste_type";
  const typeColumn = mode === "damage" ? "damage_type" : "waste_type";
  const table = mode === "damage" ? "inventory_damages" : "inventory_waste";

  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;

  const rpcPayload: Record<string, any> = {
    _product_id: payload.product_id,
    _qty: payload.qty,
    [typeParam]: payload.type,
    _batch_id: payload.batch_id,
    _reason: payload.reason,
    _note: payload.note,
  };

  if (!offline) {
    try {
      const { error } = await supabase.rpc(rpcName as any, rpcPayload as any);
      if (error) throw error;
      return { offline: false };
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const id = uuid();
  const now = new Date().toISOString();
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;
  const device_id = getDeviceId();

  await db().transaction("rw", db().products, db().product_batches, (db() as any)[table], async () => {
    const p = await db().products.get(payload.product_id);
    let unitCost = Number(p?.cost_price ?? 0);

    if (p) {
      const baseStock =
        typeof p.stock === "number"
          ? Number(p.stock)
          : typeof p.stock_qty === "number"
            ? Number(p.stock_qty)
            : null;
      if (baseStock != null) {
        const nextStock = +(baseStock - payload.qty).toFixed(3);
        await db().products.put({
          ...p,
          stock: nextStock,
          ...(typeof p.stock_qty === "number" ? { stock_qty: nextStock } : {}),
          _sync: "pending",
          updated_at: now,
        });
      }
    }

    if (payload.batch_id) {
      const b = await db().product_batches.get(payload.batch_id);
      if (b) {
        const nextRemaining = Math.max(Number(b.qty_remaining ?? 0) - payload.qty, 0);
        await db().product_batches.put({
          ...b,
          qty_remaining: nextRemaining,
          status: nextRemaining <= 0 ? "depleted" : b.status,
          updated_at: now,
          _sync: "pending",
        });
        if (b.unit_cost) unitCost = Number(b.unit_cost);
      }
    }

    await (db() as any)[table].put({
      id,
      tenant_id,
      product_id: payload.product_id,
      batch_id: payload.batch_id,
      qty: payload.qty,
      [typeColumn]: payload.type,
      unit_cost: unitCost,
      total_value: +(unitCost * payload.qty).toFixed(2),
      reason: payload.reason,
      note: payload.note,
      created_at: now,
      _sync: "pending",
      _offline_pending: true,
      _device_id: device_id,
    });
  });

  await enqueueWrite({ op: "rpc", table: rpcName, tenant_id, payload: rpcPayload });

  return { offline: true };
}

export const recordDamageOfflineAware = (payload: DisposalPayload) => recordDisposalOfflineAware("damage", payload);
export const recordWasteOfflineAware = (payload: DisposalPayload) => recordDisposalOfflineAware("waste", payload);
