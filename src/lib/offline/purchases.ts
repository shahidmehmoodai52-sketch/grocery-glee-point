// Offline-aware Purchase (receiving stock).
//
// Online  : calls adjust_product_stock for each manual stock correction (if
//           any), then the complete_purchase RPC — exactly the order
//           purchases.tsx already used.
// Offline : applies the same corrections + received qty directly to the
//           local product mirror, writes a local purchase + items record,
//           and queues the same RPC calls (in the same order) for replay.
//
// Scoped to NEW purchase creation only. Editing/deleting an existing
// purchase is a multi-step, non-atomic sequence of raw table reads/writes
// even online today — queuing that reliably needs its own dedicated pass,
// so it stays online-only.

import { supabase } from "@/integrations/supabase/client";
import { db } from "./db";
import { getOfflineStatus, isEffectivelyOffline } from "./status";
import { enqueueWrite } from "./sync";
import { getDeviceId, getMeta } from "./device";

export interface PurchaseItemPayload {
  product_id: string | null;
  name: string;
  qty: number;
  cost: number;
  line_total: number;
  batch_no?: string;
  expiry_date?: string;
  mfg_date?: string;
  bonus_qty?: number;
}

export interface PurchasePayload {
  supplier_id: string | null;
  tax: number;
  subtotal: number;
  total: number;
  paid: number;
  incentive_amount: number;
  note: string | null;
  payment_method: string;
  account_id?: string;
  created_at?: string;
  items: PurchaseItemPayload[];
}

/** A manual stock correction entered alongside this purchase (rare — only
 *  when the cashier overrides the displayed stock during entry). */
export interface StockCorrection {
  product_id: string;
  new_stock: number;
  reason: string;
}

export function isOffline() {
  return isEffectivelyOffline();
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

/** Device-scoped so two offline terminals in the same tenant never collide.
 *  The server assigns the final invoice number on sync. */
function nextLocalPurchaseNo(): string {
  const key = "tillix_local_purchase_seq";
  let n = 1;
  try {
    n = Number(window.localStorage.getItem(key) ?? "0") + 1;
    window.localStorage.setItem(key, String(n));
  } catch {
    /* ignore */
  }
  const dev = getDeviceId().replace(/-/g, "").slice(0, 4).toUpperCase();
  return `OFF-P${dev}-${String(n).padStart(4, "0")}`;
}

/** Returns `{ offline }`. The local purchase row is written directly to the
 *  Dexie mirror (picked up by the existing purchases.tsx list read), so
 *  there's nothing else for the caller to do with the result. */
export async function completePurchaseOfflineAware(
  payload: PurchasePayload,
  corrections: StockCorrection[] = [],
): Promise<{ offline: boolean }> {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;

  if (!offline) {
    try {
      for (const c of corrections) {
        const { error } = await supabase.rpc("adjust_product_stock", {
          _product_id: c.product_id,
          _new_stock: c.new_stock,
          _reason: c.reason,
        });
        if (error) throw error;
      }
      const { error } = await supabase.rpc("complete_purchase", { payload: payload as any });
      if (error) throw error;
      return { offline: false };
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const clientUuid = uuid();
  const now = new Date().toISOString();
  const device_id = getDeviceId();
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;
  const user_id = (await getMeta<string>("user_id")) ?? null;
  const localId = clientUuid;

  let supplierName: string | null = null;
  if (payload.supplier_id) {
    try {
      supplierName = (await db().suppliers.get(payload.supplier_id))?.name ?? null;
    } catch {
      /* best effort */
    }
  }

  const items = payload.items.map((it, idx) => ({
    id: `${localId}:${idx}`,
    purchase_id: localId,
    tenant_id,
    product_id: it.product_id,
    name: it.name,
    qty: it.qty,
    cost: it.cost,
    line_total: it.line_total,
    batch_no: it.batch_no ?? null,
    expiry_date: it.expiry_date ?? null,
    mfg_date: it.mfg_date ?? null,
    bonus_qty: it.bonus_qty ?? 0,
  }));

  const invoiceNo = nextLocalPurchaseNo();
  const purchase: any = {
    id: localId,
    invoice_no: invoiceNo,
    supplier_id: payload.supplier_id,
    tenant_id,
    device_id,
    user_id,
    created_by: user_id,
    subtotal: payload.subtotal,
    tax: payload.tax,
    total: payload.total,
    paid: payload.paid,
    incentive_amount: payload.incentive_amount,
    note: payload.note,
    payment_method: payload.payment_method,
    account_id: payload.account_id ?? null,
    created_at: payload.created_at || now,
    updated_at: now,
    _sync: "pending",
    _v: 1,
    _deleted: 0,
    _offline_pending: true,
    _device_id: device_id,
    _client_uuid: clientUuid,
    suppliers: supplierName ? { name: supplierName } : null,
  };

  await db().transaction("rw", db().purchases, db().purchase_items, db().products, async () => {
    // Manual stock corrections apply first, matching the online order — the
    // purchase's own received qty is added on top of the corrected baseline.
    for (const c of corrections) {
      const p = await db().products.get(c.product_id);
      if (!p) continue;
      await db().products.put({
        ...p,
        stock: c.new_stock,
        ...(typeof p.stock_qty === "number" ? { stock_qty: c.new_stock } : {}),
        _sync: "pending",
        updated_at: now,
      });
    }

    await db().purchases.put({ ...purchase, purchase_items: items });
    await db().purchase_items.bulkPut(items);

    // Add received stock. The server recomputes the precise weighted-average
    // cost_price on sync — the local mirror only needs a correct-enough
    // stock count to keep selling offline, so cost/sell price are left as-is
    // here rather than guessed at.
    for (const it of payload.items) {
      if (!it.product_id) continue;
      const p = await db().products.get(it.product_id);
      if (!p) continue;
      const baseStock =
        typeof p.stock === "number"
          ? Number(p.stock)
          : typeof p.stock_qty === "number"
            ? Number(p.stock_qty)
            : null;
      if (baseStock == null) continue;
      const delta = Number(it.qty || 0) + Number(it.bonus_qty || 0);
      const nextStock = +(baseStock + delta).toFixed(3);
      await db().products.put({
        ...p,
        stock: nextStock,
        ...(typeof p.stock_qty === "number" ? { stock_qty: nextStock } : {}),
        _sync: "pending",
        updated_at: now,
      });
    }
  });

  // Queue corrections before the purchase itself — adjust_product_stock's
  // queue priority (60) already runs ahead of complete_purchase's (65), but
  // enqueueing in this order too keeps chronological order consistent.
  for (const c of corrections) {
    await enqueueWrite({
      op: "rpc",
      table: "adjust_product_stock",
      tenant_id,
      payload: { _product_id: c.product_id, _new_stock: c.new_stock, _reason: c.reason },
    });
  }

  await enqueueWrite({
    op: "rpc",
    table: "complete_purchase",
    client_uuid: clientUuid,
    tenant_id,
    payload: {
      payload: {
        ...payload,
        _local_id: localId,
        _local_invoice_no: invoiceNo,
        _device_id: device_id,
        _tenant_id: tenant_id,
        _user_id: user_id,
      },
    },
  });

  return { offline: true };
}

/** Applies a sell_price change to the local product mirror and queues it for
 *  replay, mirroring the "push changed sale rates onto products" step that
 *  runs after a purchase — same offline-aware shape as the purchase itself. */
export async function updateSellPriceOfflineAware(
  productId: string,
  sellPrice: number,
): Promise<void> {
  const enabled = getOfflineStatus().enabled;
  if (!(isOffline() && enabled)) {
    try {
      const { error } = await supabase
        .from("products")
        .update({ sell_price: sellPrice })
        .eq("id", productId);
      if (error) throw error;
      return;
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const p = await db().products.get(productId);
  if (p) {
    await db().products.put({
      ...p,
      sell_price: sellPrice,
      _sync: "pending",
      updated_at: new Date().toISOString(),
    });
  }
  await enqueueWrite({
    op: "update",
    table: "products",
    payload: { id: productId, sell_price: sellPrice },
  });
}
