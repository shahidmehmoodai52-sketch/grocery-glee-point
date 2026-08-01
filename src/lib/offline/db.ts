// Offline-first local mirror using Dexie (IndexedDB).
// Tables mirror cloud schema — sync engine keeps them fresh via `updated_at` watermark.
// Turn 1: schema + basic accessors. Wiring into POS/purchases/etc. happens in later turns.

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
  local_created_at: string;   // ISO
  attempts: number;
  last_error: string | null;
  status: "pending" | "syncing" | "failed" | "done";
}

class PosOfflineDB extends Dexie {
  products!: Table<any, string>;
  product_barcodes!: Table<any, string>;
  customers!: Table<any, string>;
  suppliers!: Table<any, string>;
  sales!: Table<any, string>;
  sale_items!: Table<any, string>;
  purchases!: Table<any, string>;
  purchase_items!: Table<any, string>;
  expenses!: Table<any, string>;
  store_settings!: Table<any, string>;
  user_roles!: Table<any, string>;
  _sync_state!: Table<SyncState, string>;
  _queue!: Table<QueuedWrite, number>;

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
  "purchases", "purchase_items", "expenses", "store_settings", "user_roles",
] as const;
export type MirroredTable = typeof MIRRORED_TABLES[number];
