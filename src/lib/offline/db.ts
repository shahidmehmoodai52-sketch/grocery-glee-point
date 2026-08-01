// Offline-first local mirror using Dexie (IndexedDB).
// Tables mirror cloud schema — sync engine keeps them fresh via `updated_at` watermark.

import Dexie, { type Table } from "dexie";

/** A single-row settings/state table so we can persist the last-pulled watermark per source table. */
export interface SyncState {
  table: string;              // primary key
  last_pulled_at: string | null; // ISO
  last_error: string | null;
}

/** Local mirror of `sync_queue` — pending writes generated while offline. */
export interface QueuedWrite {
  id?: number;                // auto-inc PK
  op: "insert" | "update" | "delete" | "rpc";
  table: string;              // or rpc name
  payload: any;
  /** Client-generated idempotency key — prevents duplicate cloud writes on retry. */
  client_uuid: string;
  device_id: string;
  local_created_at: string;   // ISO
  attempts: number;
  last_error: string | null;
  status: "pending" | "syncing" | "failed" | "done";
}

/** Arbitrary key/value meta (device id, active tenant, sale counters…). */
export interface MetaRow {
  key: string;
  value: any;
}

class PosOfflineDB extends Dexie {
  products!: Table<any, string>;
  product_barcodes!: Table<any, string>;
  customers!: Table<any, string>;
  suppliers!: Table<any, string>;
  sales!: Table<any, string>;
  sale_items!: Table<any, string>;
  sale_returns!: Table<any, string>;
  sale_return_items!: Table<any, string>;
  purchases!: Table<any, string>;
  purchase_items!: Table<any, string>;
  expenses!: Table<any, string>;
  held_bills!: Table<any, string>;
  cash_accounts!: Table<any, string>;
  store_settings!: Table<any, string>;
  user_roles!: Table<any, string>;
  _sync_state!: Table<SyncState, string>;
  _queue!: Table<QueuedWrite, number>;
  _meta!: Table<MetaRow, string>;

  constructor() {
    super("pos_offline");
    this.version(1).stores({
      products: "id, name, barcode, category, updated_at",
      product_barcodes: "id, product_id, barcode, updated_at",
      customers: "id, name, phone, updated_at",
      suppliers: "id, name, phone, updated_at",
      sales: "id, invoice_no, customer_id, created_at, updated_at",
      sale_items: "id, sale_id, product_id",
      sale_returns: "id, return_no, customer_id, created_at, updated_at",
      sale_return_items: "id, return_id, product_id",
      purchases: "id, supplier_id, created_at, updated_at",
      purchase_items: "id, purchase_id, product_id",
      expenses: "id, created_at, updated_at",
      store_settings: "id",
      user_roles: "id, user_id, role",
      _sync_state: "table",
      _queue: "++id, status, table, local_created_at",
    });
    // v2 — held bills + cash accounts mirror, meta store, richer product indexes
    // (sku / item_code / category) so offline search stays instant at 100k+ rows.
    this.version(2).stores({
      products: "id, name, barcode, sku, item_code, category, updated_at",
      held_bills: "id, status, created_at",
      cash_accounts: "id, name, slug",
      _meta: "key",
      _queue: "++id, status, table, local_created_at, client_uuid",
    });
  }
}

let _db: PosOfflineDB | null = null;

/** Lazy singleton — never instantiate at module load (SSR safety). */
export function db(): PosOfflineDB {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB not available (SSR or unsupported browser)");
  }
  if (!_db) _db = new PosOfflineDB();
  return _db;
}

export const MIRRORED_TABLES = [
  "products", "product_barcodes", "customers", "suppliers",
  "sales", "sale_items", "sale_returns", "sale_return_items",
  "purchases", "purchase_items", "expenses", "held_bills",
  "cash_accounts", "store_settings", "user_roles",
] as const;
export type MirroredTable = typeof MIRRORED_TABLES[number];
