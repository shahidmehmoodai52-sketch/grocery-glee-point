// POS-specific offline-first helpers.
//
// - Warm local IndexedDB cache from cloud reads (products, customers, barcodes).
// - Fall back to local cache when offline or a network error occurs.
// - Complete a sale offline: generate a local invoice, decrement local stock,
//   enqueue the `complete_sale` RPC for sync.

import { supabase } from "@/integrations/supabase/client";
import { db } from "./db";
import { getOfflineStatus } from "./status";
import { enqueueWrite } from "./sync";

function isOffline() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return false;
}

/** Heuristic: treat fetch/network/timeout/DNS errors as "offline-ish"
 *  so we can gracefully fall back even when navigator.onLine lies
 *  (captive portal, Wi-Fi up but ISP down, VPN blip, etc.). */
function isNetworkError(e: any): boolean {
  const msg = String(e?.message ?? e ?? "").toLowerCase();
  if (!msg) return false;
  return /failed to fetch|network(error)?|networkerror|fetch failed|load failed|timeout|timed out|offline|dns|err_(internet|network|name_not_resolved|connection)|socket|aborted|econn|enotfound/.test(
    msg,
  );
}


/** Try cloud, warm local cache on success. On network failure (offline / fetch throw),
 *  fall back to local cache. On other errors, rethrow so the UI shows them. */
export async function offlineFirst<T>(
  onlineFn: () => Promise<T>,
  cacheReader: () => Promise<T>,
  cacheWriter?: (data: T) => Promise<void>,
): Promise<T> {
  const enabled = getOfflineStatus().enabled;
  if (isOffline() && enabled) {
    return cacheReader();
  }
  try {
    const data = await onlineFn();
    if (enabled && cacheWriter) { try { await cacheWriter(data); } catch {/* cache write is best-effort */} }
    return data;
  } catch (e: any) {
    if (enabled && isNetworkError(e)) {
      return cacheReader();
    }
    throw e;
  }

}

/** Warm helpers used by both queryFns and the sync engine. */
export async function cacheProducts(rows: any[]) {
  if (!rows?.length) return;
  await db().products.bulkPut(rows);
}
export async function cacheCustomers(rows: any[]) {
  if (!rows?.length) return;
  await db().customers.bulkPut(rows);
}
export async function cacheSuppliers(rows: any[]) {
  if (!rows?.length) return;
  await db().suppliers.bulkPut(rows);
}
export async function cachePurchases(rows: any[]) {
  if (!rows?.length) return;
  await db().purchases.bulkPut(rows);
}
export async function cacheExpenses(rows: any[]) {
  if (!rows?.length) return;
  await db().expenses.bulkPut(rows);
}

/** Insert a row online, or queue it for sync when offline.
 *  Assigns a client UUID so the row can be shown immediately and reconciled later. */
export async function insertOfflineAware<T extends Record<string, any>>(
  table: "customers" | "suppliers" | "expenses",
  values: T,
): Promise<T & { id: string; _offline_pending?: boolean }> {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;
  const now = new Date().toISOString();
  // Only `expenses` has updated_at; suppliers/customers don't — sending it triggers
  // a PostgREST "schema cache" error on insert.
  const hasUpdatedAt = table === "expenses";
  const withId: any = {
    ...values,
    id: (values as any).id ?? ((typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `local-${Date.now()}`),
    created_at: (values as any).created_at ?? now,
    ...(hasUpdatedAt ? { updated_at: now } : {}),
  };

  const saveOffline = async () => {
    const marked = { ...withId, _offline_pending: true };
    try { await (db() as any)[table]?.put(marked); } catch {}
    await enqueueWrite({ op: "insert", table, payload: withId });
    return marked;
  };

  if (!offline) {
    try {
      const { data, error } = await supabase.from(table as any).insert(withId).select("*").maybeSingle();
      if (error) throw error;
      const row = (data ?? withId) as any;
      if (enabled) { try { await (db() as any)[table]?.put(row); } catch {} }
      return row;
    } catch (e: any) {
      if (enabled && isNetworkError(e)) return saveOffline();
      throw e;
    }
  }

  return saveOffline();
}


export async function cacheProductBarcodes(rows: any[]) {
  if (!rows?.length) return;
  // product_barcodes primary key in cloud is `id`, but our sparse rows here
  // may not have `id`. Derive a stable synthetic key `product_id:barcode` so
  // bulkPut doesn't fail.
  const withKey = rows.map((r: any) => ({ ...r, id: r.id ?? `${r.product_id}:${r.barcode}` }));
  await db().product_barcodes.bulkPut(withKey);
}

/** Local-generated invoice numbers use OFF-<epoch>-<counter> prefix so they
 *  never collide with server numbers. Server assigns the final number on sync. */
function nextLocalInvoiceNo(): string {
  const key = "pos_local_invoice_counter";
  let n = 0;
  try { n = Number(window.localStorage.getItem(key) ?? "0") || 0; } catch {}
  n += 1;
  try { window.localStorage.setItem(key, String(n)); } catch {}
  return `OFF-${Date.now().toString(36).toUpperCase()}-${n}`;
}

export interface CompleteSalePayload {
  customer_id: string | null;
  expense_person_id: string | null;
  payment_method: string;
  tax: number;
  discount: number;
  paid: number;
  note: string;
  items: Array<{ product_id: string | null; name: string; qty: number; price: number; cost: number }>;
}

/** Online-first sale. When offline, records the sale locally and queues the RPC.
 *  Returns a sale-shaped object matching the cloud response so the UI can print it. */
export async function completeSaleOfflineAware(payload: CompleteSalePayload) {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;

  if (!offline) {
    try {
      // Normal online path.
      const { data, error } = await supabase.rpc("complete_sale", { payload: payload as any });
      if (error) throw error;
      const { data: sale, error: readErr } = await supabase
        .from("sales")
        .select("*, sale_items(*), customers(name,phone)")
        .eq("id", data as string)
        .maybeSingle();
      if (readErr) throw readErr;
      // Cache locally so reprint works after refresh even offline.
      if (enabled && sale) {
        try {
          await db().sales.put(sale);
          if (Array.isArray((sale as any).sale_items)) {
            await db().sale_items.bulkPut((sale as any).sale_items);
          }
        } catch {/* best effort */}
      }
      return { sale, offline: false };
    } catch (e: any) {
      // Network died mid-request → fall through to the offline path
      // so the cashier never loses a sale.
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }


  // Offline path — build a local sale record and enqueue the RPC for sync.
  const subtotal = payload.items.reduce((s, i) => s + i.qty * i.price, 0);
  const total = +(subtotal - payload.discount + payload.tax).toFixed(2);
  const paid = +Number(payload.paid ?? 0).toFixed(2);
  const cost_total = +payload.items.reduce((s, i) => s + i.qty * i.cost, 0).toFixed(2);
  const invoice_no = nextLocalInvoiceNo();
  const now = new Date().toISOString();
  const localId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `local-${Date.now()}`;

  // Look up customer name for the receipt.
  let customerName: string | null = null;
  if (payload.customer_id) {
    try {
      const c = await db().customers.get(payload.customer_id);
      customerName = c?.name ?? null;
    } catch {/* ignore */}
  }

  const sale: any = {
    id: localId,
    invoice_no,
    customer_id: payload.customer_id,
    expense_person_id: payload.expense_person_id,
    payment_method: payload.payment_method,
    subtotal,
    discount: payload.discount,
    tax: payload.tax,
    total,
    paid,
    cost_total,
    status: paid >= total ? "completed" : "credit",
    note: payload.note,
    created_at: now,
    updated_at: now,
    _offline_pending: true, // marker so the UI can badge it
    customers: customerName ? { name: customerName, phone: null } : null,
  };

  const sale_items = payload.items.map((i, idx) => ({
    id: `${localId}:${idx}`,
    sale_id: localId,
    product_id: i.product_id,
    name: i.name,
    qty: i.qty,
    price: i.price,
    cost: i.cost,
  }));

  await db().sales.put(sale);
  await db().sale_items.bulkPut(sale_items);

  // Optimistic local stock decrement.
  for (const it of payload.items) {
    if (!it.product_id) continue;
    try {
      const p = await db().products.get(it.product_id);
      if (p && typeof p.stock_qty === "number") {
        await db().products.put({ ...p, stock_qty: +(p.stock_qty - it.qty).toFixed(3) });
      }
    } catch {/* ignore */}
  }

  // Enqueue the RPC so the sync engine can replay it against the cloud.
  await enqueueWrite({
    op: "rpc",
    table: "complete_sale",
    payload: { payload: { ...payload, _local_id: localId, _local_invoice_no: invoice_no } },
  });

  return { sale: { ...sale, sale_items }, offline: true };
}
