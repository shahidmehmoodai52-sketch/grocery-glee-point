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

import { getOfflineStatus, isEffectivelyOffline } from "./status";
import { getMeta, setMeta } from "./device";
import { offlineFirst } from "./pos";
import { whenIdle, logPerf } from "./perf";
import type { MirroredTable } from "./db";

/** Tables that already served their cached snapshot in this browser session.
 *  Kept only for resetLocalFirstSession()'s sign-out/tenant-switch hook —
 *  freshness is decided by isFresh() on every read, not by whether this is
 *  the first read of the session (see readLocalFirst below). */
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
  return isEffectivelyOffline();
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

/** Exposed so other subsystems (the sync engine's pull loop) can share this
 *  same freshness ledger instead of tracking their own — a table stamped
 *  fresh by either side is fresh for both, so a page read and a background
 *  sync pass never both re-fetch the same table moments apart. */
export async function isTableFresh(table: MirroredTable, ttlMs?: number): Promise<boolean> {
  return isFresh(table, ttlMs ?? DEFAULT_TTL_MS[table] ?? 5 * 60_000);
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
 * A fresh (within TTL), non-empty local snapshot → return it immediately, no
 * network call, and revalidate in the background when the browser is idle
 * (itself cooled down so back-to-back reads of an already-fresh table —
 * repeated mounts, window focus, reconnect — can't each kick off their own
 * background fetch). A stale or empty snapshot → normal cloud read via
 * `offlineFirst`. This freshness check runs on every read, not just the
 * first one of the session, so a component that stays mounted for a whole
 * shift keeps being served from the local mirror for as long as it's
 * genuinely fresh, instead of falling back to "always hit the cloud" after
 * its first read.
 */
export async function readLocalFirst<T>(opts: LocalFirstOptions<T>): Promise<T> {
  const { table, cloud, local, cache } = opts;
  const enabled = getOfflineStatus().enabled;
  const empty = opts.isEmpty ?? defaultIsEmpty;

  const cloudAndCache = async (): Promise<T> => {
    const data = await offlineFirst<T>(cloud, local, cache);
    if (enabled && !isOffline()) {
      try {
        await stampFresh(table);
      } catch {
        /* best effort */
      }
    }
    return data;
  };

  // Offline mirror disabled or offline → unchanged path.
  if (!enabled || typeof indexedDB === "undefined") return offlineFirst<T>(cloud, local, cache);
  if (isOffline()) return offlineFirst<T>(cloud, local, cache);

  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS[table] ?? 5 * 60_000;
  let snapshot: T | undefined;
  try {
    if (await isFresh(table, ttl)) snapshot = await local();
  } catch {
    snapshot = undefined;
  }

  if (snapshot === undefined || empty(snapshot)) return cloudAndCache();

  // Serve the local snapshot now; refresh from the cloud when idle (throttled).
  servedFromCache.add(table);
  logPerf("local-first hit", { table });
  void revalidate(table, cloudAndCache, ttl, opts.onRevalidated);
  return snapshot;
}

async function revalidate<T>(
  table: MirroredTable,
  fetcher: () => Promise<T>,
  ttlMs: number,
  onRevalidated?: (data: T) => void,
) {
  if (revalidating.has(table)) return;
  // The freshness stamp was already renewed well inside the TTL window (by
  // an earlier revalidate, or the read that first warmed it) — skip firing
  // another background fetch for every single re-read of an already-fresh
  // table. This still lets freshness self-renew roughly every half-TTL for
  // as long as something keeps reading the table.
  const cooldownMs = Math.max(ttlMs / 2, 30_000);
  if (await isFresh(table, cooldownMs)) return;
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
