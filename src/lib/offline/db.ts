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
export type QueueStatus =
  /** waiting for its turn */
  | "pending"
  /** currently being uploaded (legacy alias: "syncing") */
  | "uploading"
  | "syncing"
  /** upload confirmed by the cloud (legacy alias: "done") */
  | "uploaded"
  | "done"
  /** last attempt failed, will be retried after `next_attempt_at` */
  | "failed"
  | "retrying"
  /** retry budget exhausted — never uploaded again automatically */
  | "cancelled";

export interface QueuedWrite {
  id?: number;                // auto-inc PK
  op: "insert" | "update" | "delete" | "rpc";
  table: string;              // or rpc name
  payload: any;
  /** Client-generated idempotency key — prevents duplicate cloud writes on retry. */
  client_uuid: string;
  device_id: string;
  /** Tenant that produced the write — part of the idempotency triple. */
  tenant_id?: string | null;
  /** Local monotonic version of the record this write carries. */
  version?: number;
  local_created_at: string;   // ISO
  attempts: number;
  last_error: string | null;
  status: QueueStatus;
  /** ISO timestamp before which the item must not be retried (exponential backoff). */
  next_attempt_at?: string | null;
  /** Entity sync priority (lower runs first). Derived from `table`. */
  priority?: number;
}

/** Arbitrary key/value meta (device id, active tenant, sale counters…). */
export interface MetaRow {
  key: string;
  value: any;
}

/** Envelope fields every mirrored record carries (added on write by `record.ts`). */
export interface LocalRecordMeta {
  id: string;
  tenant_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** "synced" = came from cloud, "pending" = local write awaiting push, "conflict" = push failed. */
  _sync: "synced" | "pending" | "conflict";
  /** Soft delete — repositories filter these out of reads. */
  _deleted: 0 | 1;
  /** Monotonic local version, bumped on every local write. */
  _v: number;
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
  // v3 master-data tables
  categories!: Table<any, string>;
  units!: Table<any, string>;
  taxes!: Table<any, string>;
  shops!: Table<any, string>;
  users!: Table<any, string>;
  payment_methods!: Table<any, string>;
  barcode_settings!: Table<any, string>;
  printer_settings!: Table<any, string>;
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
    // v3 — master-data tables for the local data layer, plus envelope indexes
    // (_sync / _deleted / tenant_id) so repositories can filter without scans.
    // Existing indexes are preserved; only new ones are appended.
    this.version(3).stores({
      products:
        "id, name, barcode, sku, item_code, category, updated_at, _sync, _deleted, tenant_id, [tenant_id+_deleted], [_deleted+name]",
      product_barcodes: "id, product_id, barcode, updated_at, _deleted, [product_id+barcode]",
      customers: "id, name, phone, updated_at, _sync, _deleted, tenant_id, [_deleted+name]",
      suppliers: "id, name, phone, updated_at, _sync, _deleted, tenant_id, [_deleted+name]",
      categories: "id, name, tenant_id, _sync, _deleted, updated_at",
      units: "id, name, code, tenant_id, _sync, _deleted, updated_at",
      taxes: "id, name, rate, tenant_id, _sync, _deleted, updated_at",
      shops: "id, name, code, _sync, _deleted, updated_at",
      users: "id, user_id, email, role, tenant_id, _sync, _deleted, updated_at",
      payment_methods: "id, name, slug, tenant_id, _sync, _deleted, updated_at",
      barcode_settings: "id, tenant_id, updated_at",
      printer_settings: "id, tenant_id, updated_at",
    });
    // v4 — background sync engine: queue gains retry scheduling + entity
    // priority indexes, and a unique idempotency index on client_uuid so the
    // same transaction can never be enqueued (or uploaded) twice.
    this.version(4)
      .stores({
        _queue:
          "++id, status, table, local_created_at, &client_uuid, next_attempt_at, priority, [status+priority], [status+next_attempt_at]",
      })
      .upgrade(async (tx) => {
        await tx
          .table("_queue")
          .toCollection()
          .modify((r: any) => {
            if (r.next_attempt_at === undefined) r.next_attempt_at = null;
            if (r.tenant_id === undefined) r.tenant_id = null;
            if (r.version === undefined) r.version = 1;
            if (r.priority === undefined) r.priority = queuePriority(r.table);
            // A write interrupted by a crash/power failure is resumable.
            if (r.status === "syncing") r.status = "pending";
          });
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

/** Master-data tables — small, fully replaced on each sync pass. */
export const MASTER_TABLES = [
  "categories", "units", "taxes", "shops", "users",
  "payment_methods", "barcode_settings", "printer_settings",
] as const;
export type MasterTable = typeof MASTER_TABLES[number];

export const MIRRORED_TABLES = [
  "products", "product_barcodes", "customers", "suppliers",
  "sales", "sale_items", "sale_returns", "sale_return_items",
  "purchases", "purchase_items", "expenses", "held_bills",
  "cash_accounts", "store_settings", "user_roles",
  ...MASTER_TABLES,
] as const;
export type MirroredTable = typeof MIRRORED_TABLES[number];
