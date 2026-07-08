// Network + sync status hook for the offline badge.
import { useEffect, useState } from "react";
import { db } from "./db";

export type SyncPhase = "idle" | "syncing" | "error";

export interface OfflineStatus {
  online: boolean;
  enabled: boolean;
  phase: SyncPhase;
  pending: number;
  lastSyncedAt: string | null;
  error: string | null;
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


export function markSyncStart() {
  state = { ...state, phase: "syncing", error: null };
  emit();
}
export function markSyncDone() {
  const now = new Date().toISOString();
  try { window.localStorage.setItem(LS_LAST, now); } catch {}
  state = { ...state, phase: "idle", lastSyncedAt: now, error: null };
  emit();
}
export function markSyncError(msg: string) {
  state = { ...state, phase: "error", error: msg };
  emit();
}
export async function refreshPendingCount() {
  try {
    const n = await db()._queue.where("status").anyOf(["pending", "failed"]).count();
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

  window.addEventListener("online", () => { state = { ...state, online: true }; emit(); });
  window.addEventListener("offline", () => { state = { ...state, online: false }; emit(); });
  emit();
  void refreshPendingCount();
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
