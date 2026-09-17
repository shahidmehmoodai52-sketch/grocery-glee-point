// Network + sync status hook for the offline badge.
import { useEffect, useState } from "react";
import { db } from "./db";
import { supabase } from "@/integrations/supabase/client";

// Earlier versions of this probe hand-built their own fetch() to
// PROXY_URL/DIRECT_URL with manually-set apikey/Authorization headers —
// duplicating what client.ts's supabase instance already does, and
// repeatedly drifting out of sync with it (missing headers, a "direct URL"
// fallback client.ts never actually uses since its proxy URL always has a
// non-empty default, a bare /rest/v1/ root path whose behavior through the
// Cloudflare Worker proxy isn't guaranteed the same as a real resource
// request). Each drift silently stuck the badge on "Offline" while the app
// itself was working fine, and got patched separately each time.
//
// Routing the probe through the same `supabase` client every real query
// uses removes that whole class of bug: whatever URL, headers, and auth
// session real data-fetches use, the probe uses too, automatically. A
// HEAD request with count-only sends no row data — this is as cheap as
// the old raw fetch was.
async function probeConnectivity(): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const { error } = await supabase
      .from("products")
      .select("id", { head: true, count: "exact" })
      .abortSignal(ctrl.signal);
    return !error;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

let consecutiveFailures = 0;
let probing = false;
async function runConnectivityProbe() {
  if (probing) return;
  probing = true;
  try {
    const ok = await probeConnectivity();
    if (ok) {
      consecutiveFailures = 0;
      if (!state.online) { state = { ...state, online: true }; emit(); }
    } else {
      consecutiveFailures++;
      if (consecutiveFailures >= 2 && state.online) {
        state = { ...state, online: false }; emit();
      }
    }
  } finally {
    probing = false;
  }
}

export type SyncPhase = "idle" | "syncing" | "error";

export interface OfflineStatus {
  online: boolean;
  enabled: boolean;
  phase: SyncPhase;
  pending: number;
  lastSyncedAt: string | null;
  error: string | null;
  /** Sync progress while flushing the offline queue (null when idle). */
  progressDone: number | null;
  progressTotal: number | null;
  /** Human-readable description of the item currently uploading, e.g. "Sale S-023-1042". */
  progressLabel: string | null;
}

const LS_LAST = "pos_offline_last_synced";

type Listener = (s: OfflineStatus) => void;
const listeners = new Set<Listener>();

let state: OfflineStatus = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  enabled: true, // Auto — always on. Offline works transparently, no toggle.
  phase: "idle",
  pending: 0,
  lastSyncedAt: null,
  error: null,
  progressDone: null,
  progressTotal: null,
  progressLabel: null,
};


function emit() {
  for (const l of listeners) l(state);
}

export function getOfflineStatus() {
  return state;
}

/** Kept for backward compat — offline is always on now, this is a no-op. */
export function setOfflineEnabled(_v: boolean) {
  state = { ...state, enabled: true };
  emit();
}


export function setSyncProgress(done: number | null, total: number | null, label: string | null = null) {
  state = { ...state, progressDone: done, progressTotal: total, progressLabel: label };
  emit();
}

export function markSyncStart() {
  state = { ...state, phase: "syncing", error: null };
  emit();
}
export function markSyncDone() {
  const now = new Date().toISOString();
  try { window.localStorage.setItem(LS_LAST, now); } catch {}
  state = { ...state, phase: "idle", lastSyncedAt: now, error: null, progressDone: null, progressTotal: null, progressLabel: null };
  emit();
}
export function markSyncError(msg: string) {
  state = { ...state, phase: "error", error: msg, progressDone: null, progressTotal: null, progressLabel: null };
  emit();
}
export async function refreshPendingCount() {
  try {
    // Everything not yet confirmed by the cloud counts as pending work.
    const n = await db()._queue
      .where("status")
      .anyOf(["pending", "failed", "retrying", "uploading", "syncing"])
      .count();
    state = { ...state, pending: n };
    emit();
  } catch {/* SSR / unsupported */}
}

/** Initialise from localStorage — call once from client. */
export function bootOfflineStatus() {
  if (typeof window === "undefined") return;
  try {
    state = {
      ...state,
      enabled: true, // always on
      lastSyncedAt: window.localStorage.getItem(LS_LAST),
      online: navigator.onLine,
    };
  } catch {}

  // "online" event is only a hint — verify with a real probe before trusting it.
  window.addEventListener("online", () => { void runConnectivityProbe(); });
  // "offline" (interface actually down) is reliable — trust it immediately.
  window.addEventListener("offline", () => { consecutiveFailures = 0; state = { ...state, online: false }; emit(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void runConnectivityProbe();
  });
  emit();
  void refreshPendingCount();
  void runConnectivityProbe();
  // Every open tab burns one of these per interval against the Cloudflare
  // Worker proxy's daily request quota, on top of the "online" and
  // visibilitychange triggers below — a handful of shops left open all day
  // add up fast at a short interval (this previously ran at 15s and was a
  // major contributor to hitting the free-tier 100k/day cap).
  setInterval(() => { void runConnectivityProbe(); }, 60000);
}

export function useOfflineStatus(): OfflineStatus {
  const [s, setS] = useState<OfflineStatus>(state);
  useEffect(() => {
    const l: Listener = (n) => setS(n);
    listeners.add(l);
    setS(state);
    return () => { listeners.delete(l); };
  }, []);
  return s;
}
