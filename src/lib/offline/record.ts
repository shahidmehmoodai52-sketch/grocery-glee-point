// Record envelope helpers for the local data layer.
//
// Every row written through the repositories carries a small, uniform envelope:
//   id, tenant_id, created_at, updated_at, _sync, _deleted, _v
// Cloud columns are never renamed or removed — the envelope is additive, so
// existing readers (POS search, reprint cache, sync engine) keep working.

import type { LocalRecordMeta } from "./db";

export type SyncFlag = LocalRecordMeta["_sync"];

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `loc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Add/refresh the envelope on a single record. Non-destructive. */
export function withEnvelope<T extends Record<string, any>>(
  row: T,
  opts: { tenantId?: string | null; sync?: SyncFlag; deleted?: boolean } = {},
): T & LocalRecordMeta {
  const now = new Date().toISOString();
  const prevVersion = Number(row._v ?? 0) || 0;
  return {
    ...row,
    id: String(row.id ?? uuid()),
    tenant_id: row.tenant_id ?? opts.tenantId ?? null,
    created_at: row.created_at ?? now,
    updated_at: row.updated_at ?? now,
    _sync: opts.sync ?? (row._sync as SyncFlag) ?? "synced",
    _deleted: opts.deleted ? 1 : ((row._deleted as 0 | 1) ?? 0),
    _v: opts.sync === "pending" ? prevVersion + 1 : prevVersion || 1,
  } as T & LocalRecordMeta;
}

/** Envelope a batch. Used by the sync engine when mirroring cloud pages. */
export function withEnvelopes<T extends Record<string, any>>(
  rows: T[],
  opts: { tenantId?: string | null; sync?: SyncFlag } = {},
): Array<T & LocalRecordMeta> {
  return rows.map((r) => withEnvelope(r, opts));
}

/** True when a record should be hidden from normal reads. */
export function isLive(row: any): boolean {
  return !!row && row._deleted !== 1;
}
