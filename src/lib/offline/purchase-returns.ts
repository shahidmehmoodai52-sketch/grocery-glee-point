// Offline-aware Purchase Return.
//
// Online  : calls the `complete_purchase_return` RPC exactly as before.
// Offline : writes a local return record + items, reduces local stock (a
//           purchase return sends goods back to the supplier, the opposite
//           of a sale return), adjusts the local supplier balance mirror,
//           and queues the same RPC (with a client uuid) for replay.
//
// Mirrors sale-returns.tsx's `completeSaleReturnOfflineAware` pattern —
// business rules live in the caller (purchase-returns.tsx) and in the
// `complete_purchase_return` RPC; this module only switches the storage
// provider. Nothing here recomputes prices.

import { supabase } from "@/integrations/supabase/client";
import { db } from "./db";
import { getOfflineStatus } from "./status";
import { enqueueWrite } from "./sync";
import { getDeviceId, getMeta } from "./device";

export interface PurchaseReturnPayload {
  purchase_id: string | null;
  supplier_id: string | null;
  tax: number;
  refund_amount: number;
  refund_method: string;
  note: string | null;
  items: { product_id: string | null; name: string; qty: number; cost: number }[];
}

export interface OfflinePurchaseReturnMeta {
  original_invoice_no?: string | null;
}

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

/** Device-scoped so two offline terminals in the same tenant never collide.
 *  The server assigns the final return number on sync. */
function nextLocalPurchaseReturnNo(): string {
  const key = "tillix_local_purchase_return_seq";
  let n = 1;
  try {
    n = Number(window.localStorage.getItem(key) ?? "0") + 1;
    window.localStorage.setItem(key, String(n));
  } catch { /* ignore */ }
  const dev = getDeviceId().replace(/-/g, "").slice(0, 4).toUpperCase();
  return `OFF-PR${dev}-${String(n).padStart(4, "0")}`;
}

/** Returns `{ ret, offline }`. `ret` is shaped like the cloud row so the UI can print it. */
export async function completePurchaseReturnOfflineAware(
  payload: PurchaseReturnPayload,
  meta: OfflinePurchaseReturnMeta = {},
) {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;
  const clientUuid = uuid();

  if (!offline) {
    try {
      const { error } = await supabase.rpc("complete_purchase_return" as any, { payload: payload as any });
      if (error) throw error;
      return { ret: null, offline: false };
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const subtotal = +payload.items.reduce((s, i) => s + i.qty * i.cost, 0).toFixed(2);
  const total = +(subtotal + Number(payload.tax || 0)).toFixed(2);
  const now = new Date().toISOString();
  const localId = clientUuid;

  const device_id = getDeviceId();
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;
  const user_id = (await getMeta<string>("user_id")) ?? null;

  let supplierName: string | null = null;
  if (payload.supplier_id) {
    try { supplierName = (await db().suppliers.get(payload.supplier_id))?.name ?? null; } catch {}
  }

  let originalInvoiceNo: string | null = meta.original_invoice_no ?? null;
  if (!originalInvoiceNo && payload.purchase_id) {
    try { originalInvoiceNo = (await db().purchases.get(payload.purchase_id))?.invoice_no ?? null; } catch {}
  }

  const items = payload.items.map((i, idx) => ({
    id: `${localId}:${idx}`,
    return_id: localId,
    product_id: i.product_id,
    name: i.name,
    qty: i.qty,
    cost: i.cost,
    line_total: +(i.qty * i.cost).toFixed(2),
  }));

  const ret: any = {
    id: localId,
    return_no: nextLocalPurchaseReturnNo(),
    purchase_id: payload.purchase_id,
    supplier_id: payload.supplier_id,
    tenant_id,
    device_id,
    user_id,
    created_by: user_id,
    subtotal,
    tax: Number(payload.tax || 0),
    total,
    refund_amount: Number(payload.refund_amount || 0),
    refund_method: payload.refund_method,
    note: payload.note,
    created_at: now,
    // Audit payload for standalone offline reconciliation / reprint.
    _original_invoice_no: originalInvoiceNo,
    _inventory_impact: payload.items
      .filter((i) => i.product_id)
      .map((i) => ({ product_id: i.product_id, qty_delta: -i.qty })),
    _sync: "pending",
    sync_status: "pending",
    _v: 1,
    version: 1,
    _deleted: 0,
    _offline_pending: true,
    _device_id: device_id,
    _client_uuid: clientUuid,
    suppliers: supplierName ? { name: supplierName } : null,
  };

  await db().transaction(
    "rw",
    db().purchase_returns,
    db().purchase_return_items,
    db().products,
    db().suppliers,
    async () => {
      await db().purchase_returns.put({ ...ret, purchase_return_items: items });
      await db().purchase_return_items.bulkPut(items);

      // Remove local stock immediately so the offline POS sees corrected qty
      // — a purchase return sends goods back, the opposite of a sale return.
      for (const it of payload.items) {
        if (!it.product_id) continue;
        const p = await db().products.get(it.product_id);
        if (p) {
          const baseStock =
            typeof p.stock === "number"
              ? Number(p.stock)
              : typeof p.stock_qty === "number"
                ? Number(p.stock_qty)
                : null;
          if (baseStock == null) continue;
          const nextStock = +(baseStock - it.qty).toFixed(3);
          await db().products.put({
            ...p,
            stock: nextStock,
            ...(typeof p.stock_qty === "number" ? { stock_qty: nextStock } : {}),
            _sync: "pending",
            updated_at: now,
          });
        }
      }

      // A return is always a credit to the supplier (reduces what we owe
      // them) for the part not refunded in cash — mirrors the RPC's rule.
      if (payload.supplier_id) {
        const s = await db().suppliers.get(payload.supplier_id);
        if (s && typeof s.balance === "number") {
          await db().suppliers.put({
            ...s,
            balance: +(s.balance - (total - Number(payload.refund_amount || 0))).toFixed(2),
            _sync: "pending",
          });
        }
      }
    },
  );

  await enqueueWrite({
    op: "rpc",
    table: "complete_purchase_return",
    client_uuid: clientUuid,
    tenant_id: tenant_id,
    version: 1,
    payload: {
      payload: {
        ...payload,
        _local_id: localId,
        _local_return_no: ret.return_no,
        _device_id: device_id,
        _tenant_id: tenant_id,
        _user_id: user_id,
        _version: 1,
      },
    },
  });

  return { ret: { ...ret, purchase_return_items: items }, offline: true };
}
