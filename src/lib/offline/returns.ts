// Offline-aware Sale Return.
//
// Online  : calls the `complete_sale_return` RPC exactly as before.
// Offline  : writes a local return record + items, restores local stock,
//            and queues the same RPC (with a client uuid) for replay.

import { supabase } from "@/integrations/supabase/client";
import { db } from "./db";
import { getOfflineStatus } from "./status";
import { enqueueWrite } from "./sync";
import { getDeviceId } from "./device";

export interface SaleReturnPayload {
  sale_id: string | null;
  customer_id: string | null;
  tax: number;
  refund_amount: number;
  refund_method: string;
  note: string | null;
  items: { product_id: string | null; name: string; qty: number; price: number }[];
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

function nextLocalReturnNo(): string {
  const key = "tillix_local_return_seq";
  let n = 1;
  try {
    n = Number(window.localStorage.getItem(key) ?? "0") + 1;
    window.localStorage.setItem(key, String(n));
  } catch { /* ignore */ }
  return `OFF-R${String(n).padStart(4, "0")}`;
}

/** Returns `{ ret, offline }`. `ret` is shaped like the cloud row so the UI can print it. */
export async function completeSaleReturnOfflineAware(payload: SaleReturnPayload) {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;
  const clientUuid = uuid();

  if (!offline) {
    try {
      const { error } = await supabase.rpc("complete_sale_return" as any, { payload: payload as any });
      if (error) throw error;
      return { ret: null, offline: false };
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const subtotal = +payload.items.reduce((s, i) => s + i.qty * i.price, 0).toFixed(2);
  const total = +(subtotal + Number(payload.tax || 0)).toFixed(2);
  const now = new Date().toISOString();
  const localId = clientUuid;

  let customerName: string | null = null;
  if (payload.customer_id) {
    try { customerName = (await db().customers.get(payload.customer_id))?.name ?? null; } catch {}
  }

  const ret: any = {
    id: localId,
    return_no: nextLocalReturnNo(),
    sale_id: payload.sale_id,
    customer_id: payload.customer_id,
    subtotal,
    tax: Number(payload.tax || 0),
    total,
    refund_amount: Number(payload.refund_amount || 0),
    refund_method: payload.refund_method,
    note: payload.note,
    created_at: now,
    _offline_pending: true,
    _device_id: getDeviceId(),
    customers: customerName ? { name: customerName } : null,
  };

  const items = payload.items.map((i, idx) => ({
    id: `${localId}:${idx}`,
    return_id: localId,
    product_id: i.product_id,
    name: i.name,
    qty: i.qty,
    price: i.price,
    cost: 0,
    line_total: +(i.qty * i.price).toFixed(2),
  }));

  await db().sale_returns.put({ ...ret, sale_return_items: items });
  await db().sale_return_items.bulkPut(items);

  // Restore local stock immediately so offline POS sees the corrected quantity.
  for (const it of payload.items) {
    if (!it.product_id) continue;
    try {
      const p = await db().products.get(it.product_id);
      if (p && typeof p.stock_qty === "number") {
        await db().products.put({ ...p, stock_qty: +(p.stock_qty + it.qty).toFixed(3) });
      }
    } catch { /* ignore */ }
  }

  await enqueueWrite({
    op: "rpc",
    table: "complete_sale_return",
    client_uuid: clientUuid,
    payload: {
      payload: {
        ...payload,
        _local_id: localId,
        _local_return_no: ret.return_no,
        _device_id: getDeviceId(),
      },
    },
  });

  return { ret: { ...ret, sale_return_items: items }, offline: true };
}
