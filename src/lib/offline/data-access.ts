// Phase 3 — Smart Local Data Access Layer.
//
// Goal: on a cold start, paint master data (products, categories, customers,
// suppliers, settings) from the local mirror instantly, then revalidate in the
// background and pull ONLY changed rows from the cloud.
//
// Design guarantees (production safety):
//  * Online behaviour is unchanged apart from the FIRST read of a table per
//    browser session. Every later refetch (mutation invalidation, realtime,
//    manual refresh) always hits the cloud exactly as before.
//  * Offline behaviour is unchanged: it delegates to the existing `offlineFirst`
//    semantics (local mirror read / graceful network-error fallback).
//  * No new caches, tables or repositories — reads go through the Phase 2
//    Dexie mirror, freshness stamps live in the existing `_meta` store.
//  * Nothing here touches POS checkout, sale returns, inventory or purchases.

import { getOfflineStatus } from "./status";
import { getMeta, setMeta } from "./device";
import { offlineFirst } from "./pos";
import { whenIdle, logPerf } from "./perf";
import type { MirroredTable } from "./db";

/** Tables that already served their cached snapshot in this browser session. */
const servedFromCache = new Set<string>();
/** In-flight background revalidations, keyed by table. */
const revalidating = new Set<string>();

const FRESHNESS_KEY = (table: string) => `lf_fresh:${table}`;

/** Default freshness window per table — how old a local snapshot may be and
 *  still be good enough for the first paint. Slow-changing data gets longer. */
const DEFAULT_TTL_MS: Partial<Record<MirroredTable, number>> = {
  products: 15 * 60_000,
  product_barcodes: 15 * 60_000,
  categories: 30 * 60_000,
  customers: 10 * 60_000,
  suppliers: 10 * 60_000,
  store_settings: 5 * 60_000,
};

function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

/** Record that a table was just refreshed from the cloud. */
export async function stampFresh(table: MirroredTable): Promise<void> {
  await setMeta(FRESHNESS_KEY(table), Date.now());
}

/** Invalidate the local freshness stamp — the next read goes straight to cloud. */
export async function markLocalStale(table: MirroredTable): Promise<void> {
  await setMeta(FRESHNESS_KEY(table), 0);
  servedFromCache.delete(table);
}

async function isFresh(table: MirroredTable, ttlMs: number): Promise<boolean> {
  const ts = Number((await getMeta<number>(FRESHNESS_KEY(table))) ?? 0);
  return ts > 0 && Date.now() - ts < ttlMs;
}

export interface LocalFirstOptions<T> {
  /** Mirror table this read belongs to (drives freshness + TTL). */
  table: MirroredTable;
  /** Cloud read — the exact query the page used before. */
  cloud: () => Promise<T>;
  /** Local mirror read. */
  local: () => Promise<T>;
  /** Warm the mirror with a fresh cloud result (best effort). */
  cache?: (data: T) => Promise<void>;
  /** Override the freshness window. */
  ttlMs?: number;
  /** Treat a snapshot as unusable (default: empty array / nullish). */
  isEmpty?: (data: T) => boolean;
  /** Called with fresh cloud data after a background revalidation. */
  onRevalidated?: (data: T) => void;
}

function defaultIsEmpty(data: any): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

/**
 * Local-first read with background revalidation.
 *
 * Cold start (first read of this table in the session) + a fresh, non-empty
 * local snapshot → return the snapshot immediately and revalidate when the
 * browser is idle. Anything else → normal cloud read via `offlineFirst`.
 */
export async function readLocalFirst<T>(opts: LocalFirstOptions<T>): Promise<T> {
  const { table, cloud, local, cache } = opts;
  const enabled = getOfflineStatus().enabled;
  const empty = opts.isEmpty ?? defaultIsEmpty;

  const cloudAndCache = async (): Promise<T> => {
    const data = await offlineFirst<T>(cloud, local, cache);
    if (enabled && !isOffline()) { try { await stampFresh(table); } catch { /* best effort */ } }
    return data;
  };

  // Offline mirror disabled, offline, or already warmed this session → unchanged path.
  if (!enabled || typeof indexedDB === "undefined") return offlineFirst<T>(cloud, local, cache);
  if (isOffline()) return offlineFirst<T>(cloud, local, cache);
  if (servedFromCache.has(table)) return cloudAndCache();

  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS[table] ?? 5 * 60_000;
  let snapshot: T | undefined;
  try {
    if (await isFresh(table, ttl)) snapshot = await local();
  } catch {
    snapshot = undefined;
  }

  if (snapshot === undefined || empty(snapshot)) return cloudAndCache();

  // Serve the local snapshot now; refresh from the cloud when idle.
  servedFromCache.add(table);
  logPerf("local-first hit", { table });
  void revalidate(table, cloudAndCache, opts.onRevalidated);
  return snapshot;
}

async function revalidate<T>(
  table: MirroredTable,
  fetcher: () => Promise<T>,
  onRevalidated?: (data: T) => void,
) {
  if (revalidating.has(table)) return;
  revalidating.add(table);
  try {
    await whenIdle(800);
    if (isOffline()) return;
    const fresh = await fetcher();
    onRevalidated?.(fresh);
  } catch {
    /* background refresh is best effort — the cached snapshot stays valid */
  } finally {
    revalidating.delete(table);
  }
}

/** Forget every session-level local-first hit (used on sign-out / tenant switch). */
export function resetLocalFirstSession(): void {
  servedFromCache.clear();
  revalidating.clear();
}
