// Local repository layer.
//
// Future offline modules must read/write master data through these repositories
// instead of touching Dexie directly. This keeps indexes, the record envelope,
// soft deletes and tenant scoping in exactly one place.
//
// Read-only by design for Phase 2 apart from `upsert` (used by the sync engine
// and master-data projection). No POS/sales/returns/inventory logic lives here.

import type { Table } from "dexie";
import { db, type MirroredTable } from "./db";
import { withEnvelope, withEnvelopes, type SyncFlag } from "./record";
import { getMeta } from "./device";

export interface ListOptions {
  /** Case-insensitive prefix/substring match against the searchable fields. */
  search?: string;
  limit?: number;
  offset?: number;
  /** Include soft-deleted rows (default false). */
  includeDeleted?: boolean;
}

function table(name: MirroredTable): Table<any, string> {
  return (db() as any)[name] as Table<any, string>;
}

function norm(v: unknown): string {
  return String(v ?? "").toLowerCase();
}

/**
 * Generic repository over one local table.
 * `searchFields` drives `list({ search })`; the first field should be indexed
 * so common queries stay O(log n) instead of scanning.
 */
export class LocalRepository<T extends Record<string, any> = any> {
  constructor(
    public readonly name: MirroredTable,
    private readonly searchFields: string[] = ["name"],
  ) {}

  private t() {
    return table(this.name);
  }

  /** O(1) primary-key lookup. */
  async get(id: string): Promise<T | undefined> {
    const row = await this.t().get(id);
    return row && row._deleted !== 1 ? (row as T) : undefined;
  }

  /** Batched primary-key lookup — one IndexedDB round trip for N ids. */
  async getMany(ids: string[]): Promise<T[]> {
    if (!ids.length) return [];
    const rows = await this.t().bulkGet(ids);
    return rows.filter((r) => r && r._deleted !== 1) as T[];
  }

  /** Fast indexed lookup by any declared index (e.g. barcode, sku, slug). */
  async findBy(index: string, value: any): Promise<T[]> {
    try {
      const rows = await this.t().where(index).equals(value).toArray();
      return rows.filter((r) => r._deleted !== 1) as T[];
    } catch {
      return [];
    }
  }

  async findOneBy(index: string, value: any): Promise<T | undefined> {
    const [first] = await this.findBy(index, value);
    return first;
  }

  /**
   * Paged list with optional search. Uses the indexed prefix range when the
   * search term is long enough, so 100k-row tables never load into memory.
   */
  async list(opts: ListOptions = {}): Promise<T[]> {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const term = opts.search?.trim();
    const t = this.t();

    if (!term) {
      const rows = await t.offset(offset).limit(limit).toArray();
      return (opts.includeDeleted ? rows : rows.filter((r) => r._deleted !== 1)) as T[];
    }

    const needle = norm(term);
    const out: T[] = [];
    let skipped = 0;
    // Streaming scan with early exit — memory stays bounded regardless of size.
    await t.each((row: any) => {
      if (out.length >= limit) return;
      if (!opts.includeDeleted && row._deleted === 1) return;
      const hit = this.searchFields.some((f) => norm(row[f]).includes(needle));
      if (!hit) return;
      if (skipped < offset) {
        skipped++;
        return;
      }
      out.push(row as T);
    });
    return out;
  }

  async count(opts: { includeDeleted?: boolean } = {}): Promise<number> {
    if (opts.includeDeleted) return this.t().count();
    try {
      return await this.t().where("_deleted").equals(0).count();
    } catch {
      return this.t().count();
    }
  }

  /** Upsert rows with the standard envelope. Used by sync + master projection. */
  async upsert(rows: T | T[], opts: { sync?: SyncFlag; tenantId?: string | null } = {}): Promise<void> {
    const arr = Array.isArray(rows) ? rows : [rows];
    if (!arr.length) return;
    const tenantId = opts.tenantId ?? (await getMeta<string>("tenant_id"));
    await this.t().bulkPut(withEnvelopes(arr, { sync: opts.sync ?? "synced", tenantId }));
  }

  /** Soft delete — the row stays for future conflict resolution. */
  async softDelete(id: string): Promise<void> {
    const existing = await this.t().get(id);
    if (!existing) return;
    await this.t().put(withEnvelope(existing, { deleted: true, sync: "pending" }));
  }

  /** Replace the whole table content (small master tables only). */
  async replaceAll(rows: T[], opts: { tenantId?: string | null } = {}): Promise<void> {
    const tenantId = opts.tenantId ?? (await getMeta<string>("tenant_id"));
    await db().transaction("rw", this.t(), async () => {
      await this.t().clear();
      if (rows.length) await this.t().bulkPut(withEnvelopes(rows, { sync: "synced", tenantId }));
    });
  }

  async clear(): Promise<void> {
    await this.t().clear();
  }
}

/** Singleton repositories — import these, never Dexie tables. */
export const productsRepo = new LocalRepository("products", ["name", "sku", "item_code", "barcode"]);
export const barcodesRepo = new LocalRepository("product_barcodes", ["barcode"]);
export const customersRepo = new LocalRepository("customers", ["name", "phone"]);
export const suppliersRepo = new LocalRepository("suppliers", ["name", "phone"]);
export const categoriesRepo = new LocalRepository("categories", ["name"]);
export const unitsRepo = new LocalRepository("units", ["name", "code"]);
export const taxesRepo = new LocalRepository("taxes", ["name"]);
export const shopsRepo = new LocalRepository("shops", ["name", "code"]);
export const usersRepo = new LocalRepository("users", ["email", "role"]);
export const paymentMethodsRepo = new LocalRepository("payment_methods", ["name", "slug"]);
export const settingsRepo = new LocalRepository("store_settings", []);
export const barcodeSettingsRepo = new LocalRepository("barcode_settings", []);
export const printerSettingsRepo = new LocalRepository("printer_settings", []);

export const repositories = {
  products: productsRepo,
  product_barcodes: barcodesRepo,
  customers: customersRepo,
  suppliers: suppliersRepo,
  categories: categoriesRepo,
  units: unitsRepo,
  taxes: taxesRepo,
  shops: shopsRepo,
  users: usersRepo,
  payment_methods: paymentMethodsRepo,
  store_settings: settingsRepo,
  barcode_settings: barcodeSettingsRepo,
  printer_settings: printerSettingsRepo,
} as const;

/** Convenience: the single active store settings row, offline-safe. */
export async function getLocalSettings<T = any>(): Promise<T | null> {
  const rows = await settingsRepo.list({ limit: 1 });
  return (rows[0] as T) ?? null;
}

/** Fast barcode → product resolution used by future offline scanning. */
export async function resolveBarcode(code: string): Promise<any | undefined> {
  const trimmed = code.trim();
  if (!trimmed) return undefined;
  const direct = await productsRepo.findOneBy("barcode", trimmed);
  if (direct) return direct;
  const mapped = await barcodesRepo.findOneBy("barcode", trimmed);
  if (mapped?.product_id) return productsRepo.get(mapped.product_id);
  return productsRepo.findOneBy("sku", trimmed);
}
