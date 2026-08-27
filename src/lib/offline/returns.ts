// Offline-aware Sale Return.
//
// Online  : calls the `complete_sale_return` RPC exactly as before.
// Offline : writes a local return record + items, restores local stock,
//           adjusts the local customer ledger mirror for credit refunds,
//           and queues the same RPC (with a client uuid) for replay.
//
// Business rules (refund / tax / discount / inventory / validation) live in the
// caller (`sale-returns.tsx`) and in the `complete_sale_return` RPC — this module
// only switches the storage provider. Nothing here recomputes prices.

import { supabase } from "@/integrations/supabase/client";
import { db } from "./db";
import { getOfflineStatus } from "./status";
import { enqueueWrite } from "./sync";
import { getDeviceId, getMeta } from "./device";

export interface SaleReturnPayload {
  sale_id: string | null;
  customer_id: string | null;
  tax: number;
  refund_amount: number;
  refund_method: string;
  note: string | null;
  items: { product_id: string | null; name: string; qty: number; price: number }[];
  /** "customer" (default) or "staff". Staff returns never pay out cash — the
   *  RPC books the value to the staff member's ledger instead. */
  party_type?: "customer" | "staff";
  staff_user_id?: string | null;
}

/** Presentation/audit-only breakdown captured by the UI. Never sent to the RPC
 *  (the server derives its own totals); stored on the local record so an
 *  offline return can be audited, reprinted and reconciled without the cloud. */
export interface OfflineReturnMeta {
  discount?: number;
  tax_breakdown?: Array<{ rate: number; amount: number }>;
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
function nextLocalReturnNo(): string {
  const key = "tillix_local_return_seq";
  let n = 1;
  try {
    n = Number(window.localStorage.getItem(key) ?? "0") + 1;
    window.localStorage.setItem(key, String(n));
  } catch { /* ignore */ }
  const dev = getDeviceId().replace(/-/g, "").slice(0, 4).toUpperCase();
  return `OFF-R${dev}-${String(n).padStart(4, "0")}`;
}

/** Returns `{ ret, offline }`. `ret` is shaped like the cloud row so the UI can print it. */
export async function completeSaleReturnOfflineAware(
  payload: SaleReturnPayload,
  meta: OfflineReturnMeta = {},
) {
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

  // Transaction identity — every offline return carries tenant/device/user +
  // sync status + version so it can be reconciled safely later.
  const device_id = getDeviceId();
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;
  const user_id = (await getMeta<string>("user_id")) ?? null;

  let customerName: string | null = null;
  if (payload.customer_id) {
    try { customerName = (await db().customers.get(payload.customer_id))?.name ?? null; } catch {}
  }

  // Original invoice reference (for the receipt + reconciliation).
  let originalInvoiceNo: string | null = meta.original_invoice_no ?? null;
  if (!originalInvoiceNo && payload.sale_id) {
    try { originalInvoiceNo = (await db().sales.get(payload.sale_id))?.invoice_no ?? null; } catch {}
  }

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

  const partyType = payload.party_type ?? "customer";
  const staffUserId = partyType === "staff" ? (payload.staff_user_id ?? null) : null;
  // Staff returns never pay out cash locally either — mirrors the RPC's rule.
  const effectiveRefund = partyType === "staff" ? 0 : Number(payload.refund_amount || 0);
  const effectiveMethod = partyType === "staff" ? "staff_ledger" : payload.refund_method;

  const ret: any = {
    id: localId,
    return_no: nextLocalReturnNo(),
    sale_id: payload.sale_id,
    customer_id: partyType === "staff" ? null : payload.customer_id,
    party_type: partyType,
    staff_user_id: staffUserId,
    tenant_id,
    device_id,
    user_id,
    created_by: user_id,
    subtotal,
    tax: Number(payload.tax || 0),
    total,
    refund_amount: effectiveRefund,
    refund_method: effectiveMethod,
    note: payload.note,
    created_at: now,
    updated_at: now,
    // Audit payload for standalone offline reconciliation / reprint.
    _original_invoice_no: originalInvoiceNo,
    _discounts: { effective: +Number(meta.discount ?? 0).toFixed(2) },
    _taxes: { total: Number(payload.tax || 0), breakdown: meta.tax_breakdown ?? [] },
    _refund: { amount: effectiveRefund, method: effectiveMethod },
    _inventory_impact: payload.items
      .filter((i) => i.product_id)
      .map((i) => ({ product_id: i.product_id, qty_delta: i.qty })),
    _sync: "pending",
    sync_status: "pending",
    _v: 1,
    version: 1,
    _deleted: 0,
    _offline_pending: true,
    _device_id: device_id,
    _client_uuid: clientUuid,
    customers: customerName ? { name: customerName } : null,
  };

  await db().transaction(
    "rw",
    db().sale_returns,
    db().sale_return_items,
    db().products,
    db().customers,
    async () => {
      await db().sale_returns.put({ ...ret, sale_return_items: items });
      await db().sale_return_items.bulkPut(items);

      // Restore local stock immediately so the offline POS sees corrected qty.
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
          const nextStock = +(baseStock + it.qty).toFixed(3);
          await db().products.put({
            ...p,
            stock: nextStock,
            ...(typeof p.stock_qty === "number" ? { stock_qty: nextStock } : {}),
            _sync: "pending",
            updated_at: now,
          });
        }
      }

      // Staff returns adjust `tenant_members.staff_ledger_balance` server-side once
      // this queued write syncs — there's no local staff-ledger mirror to update here.
      // Credit refunds reduce what the customer owes in the local mirror.
      if (partyType === "customer" && payload.customer_id && payload.refund_method === "credit") {
        const c = await db().customers.get(payload.customer_id);
        if (c && typeof c.balance === "number") {
          await db().customers.put({
            ...c,
            balance: +(c.balance - Number(payload.refund_amount || 0)).toFixed(2),
            _sync: "pending",
          });
        }
      }
    },
  );

  await enqueueWrite({
    op: "rpc",
    table: "complete_sale_return",
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

  return { ret: { ...ret, sale_return_items: items }, offline: true };
}
