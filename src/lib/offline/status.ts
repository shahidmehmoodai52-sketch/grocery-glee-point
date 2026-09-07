// Network + sync status hook for the offline badge.
import { useEffect, useState } from "react";
import { db } from "./db";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/** Real connectivity probe — navigator.onLine only reflects the network
 *  interface, not actual reachability (Windows/Chrome NCSI can report
 *  offline even when the internet works fine). This hits our own
 *  Supabase REST endpoint with a short timeout as ground truth. */
async function probeConnectivity(): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return navigator.onLine;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/store_settings?select=id&limit=1`, {
      method: "HEAD",
      headers: { apikey: SUPABASE_KEY },
      signal: ctrl.signal,
      cache: "no-store",
    });
    return res.ok || res.status === 206;
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
  setInterval(() => { void runConnectivityProbe(); }, 15000);
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
