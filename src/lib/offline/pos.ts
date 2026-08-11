// POS-specific offline-first helpers.
//
// - Warm local IndexedDB cache from cloud reads (products, customers, barcodes).
// - Fall back to local cache when offline or a network error occurs.
// - Complete a sale offline: generate a local invoice, decrement local stock,
//   enqueue the `complete_sale` RPC for sync.

import { supabase } from "@/integrations/supabase/client";
import { db } from "./db";
import { getDeviceId, getMeta } from "./device";
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

/** Local-generated invoice numbers use OFF-<device>-<epoch>-<counter> so they
 *  never collide with server numbers, nor with another terminal's offline
 *  numbers for the same tenant. Server assigns the final number on sync. */
function nextLocalInvoiceNo(): string {
  const key = "pos_local_invoice_counter";
  let n = 0;
  try { n = Number(window.localStorage.getItem(key) ?? "0") || 0; } catch {}
  n += 1;
  try { window.localStorage.setItem(key, String(n)); } catch {}
  const dev = getDeviceId().replace(/-/g, "").slice(0, 4).toUpperCase();
  return `OFF-${dev}-${Date.now().toString(36).toUpperCase()}-${n}`;
}


export interface CompleteSalePayload {
  customer_id: string | null;
  expense_person_id: string | null;
  payment_method: string;
  tax: number;
  discount: number;
  paid: number;
  note: string;
  digital_cash_back_mode?: boolean;
  digital_received_amount?: number | null;
  digital_account_id?: string | null;
  cash_back_amount?: number | null;
  items: Array<{ product_id: string | null; name: string; qty: number; price: number; cost: number }>;
}

/** Presentation/audit-only breakdown captured by the POS UI. It is NEVER sent to
 *  `complete_sale` (the server derives its own totals from the same figures);
 *  it is only stored on the local record so an offline sale can be audited,
 *  reprinted and reconciled without the cloud. */
export interface OfflineSaleMeta {
  charge?: number;
  line_discount_total?: number;
  bill_discount?: number;
  tax_breakdown?: Array<{ rate: number; amount: number }>;
  payments?: Array<{ method: string; amount: number }>;
  tendered?: number;
  change_due?: number;
}

/** Online-first sale. When offline, records the sale locally and queues the RPC.
 *  Returns a sale-shaped object matching the cloud response so the UI can print it. */
export async function completeSaleOfflineAware(payload: CompleteSalePayload, meta: OfflineSaleMeta = {}) {
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
  const requestedPaid = Number(payload.paid ?? 0);
  const paid = +(payload.digital_cash_back_mode ? Math.max(total, Math.min(requestedPaid, total)) : Math.min(requestedPaid, total)).toFixed(2);
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

  // Transaction identity — every offline sale carries tenant/device/user +
  // sync status + version so it can be reconciled safely later.
  const device_id = getDeviceId();
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;
  const user_id = (await getMeta<string>("user_id")) ?? null;

  const sale: any = {
    id: localId,
    invoice_no,
    tenant_id,
    device_id,
    user_id,
    created_by: user_id,
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
    // Audit payload required for standalone offline reconciliation.
    charge: +Number(meta.charge ?? 0).toFixed(2),
    _discounts: {
      line_total: +Number(meta.line_discount_total ?? 0).toFixed(2),
      bill: +Number(meta.bill_discount ?? 0).toFixed(2),
      effective: payload.discount,
    },
    _taxes: { total: payload.tax, breakdown: meta.tax_breakdown ?? [] },
    _payments: meta.payments ?? [{ method: payload.payment_method, amount: paid }],
    _tendered: +Number(meta.tendered ?? paid).toFixed(2),
    change_due: +Number(meta.change_due ?? 0).toFixed(2),
    _inventory_impact: payload.items
      .filter((i) => !!i.product_id)
      .map((i) => ({ product_id: i.product_id, qty_delta: -Math.abs(Number(i.qty) || 0) })),
    _offline_pending: true, // marker so the UI can badge it
    _sync: "pending",
    sync_status: "pending",
    _v: 1,
    version: 1,
    _deleted: 0,
    customers: customerName ? { name: customerName, phone: null } : null,
  };


  const sale_items = payload.items.map((i, idx) => ({
    id: `${localId}:${idx}`,
    sale_id: localId,
    tenant_id,
    product_id: i.product_id,
    name: i.name,
    qty: i.qty,
    price: i.price,
    cost: i.cost,
    _sync: "pending",
    _v: 1,
    _deleted: 0,
  }));

  await db().sales.put(sale);
  await db().sale_items.bulkPut(sale_items);

  // Optimistic local stock decrement (kept in one transaction so a crash
  // mid-loop can't leave stock half-deducted).
  try {
    await db().transaction("rw", db().products, async () => {
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
            _v: (Number(p._v ?? 0) || 0) + 1,
          });
        }
      }
    });
  } catch {/* ignore */}


  // Enqueue the RPC so the sync engine can replay it against the cloud.
  await enqueueWrite({
    op: "rpc",
    table: "complete_sale",
    // The local sale id is the idempotency key: replaying this sale can never
    // enqueue (or upload) it twice.
    client_uuid: localId,
    tenant_id: tenant_id,
    version: 1,
    payload: {
      payload: {
        ...payload,
        _local_id: localId,
        _local_invoice_no: invoice_no,
        _device_id: device_id,
        _tenant_id: tenant_id,
        _user_id: user_id,
        _created_at: now,
        _version: 1,
      },
    },
  });

  return { sale: { ...sale, sale_items }, offline: true };
}

/** Indexed offline product search — designed to stay instant at 100k+ rows.
 *  Uses Dexie indexes for exact barcode/sku/item-code hits and a bounded
 *  prefix/substring scan for names. */
export async function searchProductsLocal(term: string, limit = 200): Promise<any[]> {
  const q = term.trim().replace(/\s+/g, " ");
  if (!q) return [];
  const lower = q.toLowerCase();
  const d = db();
  const merged = new Map<string, any>();
  const add = (rows: any[]) => {
    for (const p of rows) {
      if (p && p.is_active !== false && !merged.has(p.id)) {
        merged.set(p.id, { ...p, _matched_barcodes: [] });
      }
    }
  };

  // 1. Exact code hits first (barcode scanning must be instant).
  try { add(await d.products.where("barcode").equals(q).toArray()); } catch {}
  try { add(await d.products.where("sku").equalsIgnoreCase(q).toArray()); } catch {}
  try { add(await d.products.where("item_code").equalsIgnoreCase(q).toArray()); } catch {}
  try {
    const links = await d.product_barcodes.where("barcode").equals(q).toArray();
    const ids = links.map((l: any) => l.product_id).filter(Boolean);
    if (ids.length) {
      const rows = await d.products.where("id").anyOf(ids).toArray();
      for (const p of rows) {
        merged.set(p.id, {
          ...p,
          _matched_barcodes: links.filter((l: any) => l.product_id === p.id).map((l: any) => l.barcode),
        });
      }
    }
  } catch {}

  // 2. Indexed name prefix match (fast, uses the `name` index).
  try {
    add(await d.products.where("name").startsWithIgnoreCase(q).limit(limit).toArray());
  } catch {}

  // 3. Bounded substring fallback for mid-word matches.
  if (merged.size < limit) {
    try {
      const rest = limit - merged.size;
      const extra = await d.products
        .filter((p: any) => String(p.name ?? "").toLowerCase().includes(lower))
        .limit(rest)
        .toArray();
      add(extra);
    } catch {}
  }

  return Array.from(merged.values()).slice(0, limit);
}
