// Offline-first local mirror using Dexie (IndexedDB).
// Tables mirror cloud schema — sync engine keeps them fresh via `updated_at` watermark.

import Dexie, { type Table } from "dexie";

/** A single-row settings/state table so we can persist the last-pulled watermark per source table. */
export interface SyncState {
  table: string;              // primary key
  last_pulled_at: string | null; // ISO
  last_pulled_id: string | null; // UUID
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

/**
 * Mandated entity upload order. Lower value uploads first; items within the
 * same entity keep strict chronological order (inventory maths depends on it).
 *   customers → suppliers → products → sales → sale returns → inventory adj.
 */
const QUEUE_PRIORITY: Record<string, number> = {
  customers: 10,
  suppliers: 20,
  products: 30,
  product_barcodes: 31,
  sales: 40,
  sale_items: 41,
  complete_sale: 40,
  edit_sale: 42,
  undo_last_sale: 43,
  hold_bill: 45,
  resume_bill: 45,
  discard_held_bill: 45,
  sale_returns: 50,
  sale_return_items: 51,
  complete_sale_return: 50,
  purchase_returns: 55,
  purchase_return_items: 56,
  complete_purchase_return: 55,
  // A batch created offline must replay before any damage/waste record that
  // references it by batch_id (priority 60 below).
  product_batches: 58,
  create_product_batch: 58,
  inventory_movements: 60,
  adjust_product_stock: 60,
  // Purchases run after any stock correction queued for the same items
  // (priority 60 above) so the received qty adds on top of the corrected
  // baseline once both replay, matching the online call order.
  purchases: 65,
  purchase_items: 66,
  complete_purchase: 65,
  record_damage: 60,
  record_waste: 60,
  expenses: 70,
  cash_transactions: 70,
  record_payment: 70,
  record_cash_event: 70,
  asset_categories: 70,
  assets: 71,
  // A shift must be open before priority-40 sales replay so shift_report()
  // has something to attribute them to; close/emergency-close/approve must
  // run only after every financial item for that shift (sales through
  // asset writes, priority <=71) has already replayed, so the server's own
  // shift_report() aggregation — computed fresh when the RPC executes —
  // sees the shift's real totals instead of a partial replay.
  shift_sessions: 5,
  open_shift: 5,
  close_shift: 75,
  emergency_close_shift: 75,
  approve_shift: 78,
};

/** Priority for a queued write, derived from its table / RPC name. */
export function queuePriority(table: string): number {
  return QUEUE_PRIORITY[table] ?? 80;
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
  purchase_returns!: Table<any, string>;
  purchase_return_items!: Table<any, string>;
  purchases!: Table<any, string>;
  purchase_items!: Table<any, string>;
  expenses!: Table<any, string>;
  held_bills!: Table<any, string>;
  cash_accounts!: Table<any, string>;
  // v7 — customer/supplier ledger payments + the cash-transaction rows they
  // link to (for the "cash out" vs "payment" distinction), so
  // customers.$id.tsx's ledger can be built from the local mirror.
  party_payments!: Table<any, string>;
  cash_transactions!: Table<any, string>;
  product_batches!: Table<any, string>;
  inventory_damages!: Table<any, string>;
  inventory_waste!: Table<any, string>;
  asset_categories!: Table<any, string>;
  assets!: Table<any, string>;
  // v9 — cached snapshot of the product_intelligence / smart_purchase_suggestions
  // views (see version(9) below for why these aren't in the periodic pull loop).
  product_intelligence!: Table<any, string>;
  smart_purchase_suggestions!: Table<any, string>;
  // v10 — shift sessions, so shifts.tsx can open/close/report offline.
  shift_sessions!: Table<any, string>;
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
  // v6 — offline snapshot of the current user's computed permissions/role,
  // so route-guard doesn't collapse a real user to the bare fallback perms
  // on a cold offline boot (only "my-access" itself writes this table).
  my_access!: Table<any, string>;
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
      cash_accounts: "id, name, slug, tenant_id, _sync, _deleted, updated_at",
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
          // client_uuid stays a plain index (not unique): an existing device may already
        // hold legacy rows, and a failed unique-index build would brick the mirror.
        // Duplicate prevention is enforced by the lookup in `enqueueWrite`.
        "++id, status, table, local_created_at, client_uuid, next_attempt_at, priority, [status+priority], [status+next_attempt_at]",
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
    // v5 — purchase returns mirror, matching the sale_returns tables so
    // purchase-returns.tsx gets the same offline-aware save path as
    // sale-returns.tsx (previously it only worked online).
    this.version(5).stores({
      purchase_returns: "id, return_no, supplier_id, purchase_id, created_at",
      purchase_return_items: "id, return_id, product_id",
    });
    // v6 — single-row snapshot of usePermissions()'s computed result, so it
    // can go through the same readLocalFirst() pattern store_settings uses.
    this.version(6).stores({
      my_access: "id",
    });
    // v7 — party_payments (customer/supplier ledger payments) + cash_transactions
    // (the linked row that tells a payment apart from a "cash out"), so the
    // customer ledger page can build its entries from the local mirror.
    this.version(7).stores({
      party_payments: "id, party_type, party_id, created_at, [party_type+party_id]",
      cash_transactions: "id, account_id, direction, created_at, updated_at",
    });
    // v8 — expiry/batch, damage/waste, and shop-asset tables, so expiry.tsx
    // and assets.tsx get the same offline read/write support purchases and
    // sale-returns already have. `days_remaining`/`expiry_status` aren't
    // mirrored directly (they're server-computed from `expiry_date` and are
    // date-relative, so a cached value would go stale) — expiry.tsx
    // recomputes them locally from `expiry_date` + store_settings instead.
    this.version(8).stores({
      product_batches: "id, product_id, expiry_date, status, created_at, updated_at",
      inventory_damages: "id, product_id, batch_id, created_at",
      inventory_waste: "id, product_id, batch_id, created_at",
      asset_categories: "id, name, created_at, updated_at",
      assets: "id, category_id, created_at, updated_at",
    });
    // v9 — product_intelligence / smart_purchase_suggestions snapshot cache.
    // Both views have no created_at/updated_at column at all (every column is
    // computed relative to now()/CURRENT_DATE — velocity, ABC class, days
    // remaining, health score…), so there's no watermark for the periodic
    // pull engine to use, and a full-table pull on every sync tick would be
    // the exact DB-load regression this offline effort exists to avoid. So
    // these are deliberately NOT in sync.ts's PULL_TABLES — intelligence.tsx's
    // own readLocalFirst() read warms this cache on each successful online
    // load (via its `cache` callback) and serves it, TTL-bound, when offline
    // or between visits. That's a cached snapshot of the server's own
    // precomputed numbers, not a client-side reimplementation of them.
    this.version(9).stores({
      product_intelligence: "product_id, tenant_id",
      smart_purchase_suggestions: "product_id, tenant_id, supplier_id",
    });
    // v10 — shift_sessions, plus a cashier_id/user_id index on sales /
    // sale_returns / expenses so shift_report()'s aggregation (receipts,
    // cash-in, refunds, expenses for one cashier's shift window) can be
    // recomputed locally without a full-table scan. The RPC's own
    // shift_report() is still what actually gets persisted when the
    // queued open/close call replays — this is only a local preview.
    this.version(10).stores({
      shift_sessions:
        "id, cashier_id, tenant_id, status, business_date, opened_at, closed_at, created_at, updated_at, [cashier_id+status]",
      sales: "id, invoice_no, customer_id, cashier_id, created_at, updated_at",
      sale_returns: "id, return_no, customer_id, user_id, created_at, updated_at",
      expenses: "id, user_id, created_at, updated_at",
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
  "purchases", "purchase_items", "purchase_returns", "purchase_return_items", "expenses", "held_bills",
  "cash_accounts", "store_settings", "user_roles", "my_access",
  "party_payments", "cash_transactions",
  "product_batches", "inventory_damages", "inventory_waste", "asset_categories", "assets",
  "product_intelligence", "smart_purchase_suggestions", "shift_sessions",
  ...MASTER_TABLES,
] as const;
export type MirroredTable = typeof MIRRORED_TABLES[number];
