// Device identity + tenant isolation for the offline mirror.
//
// Every offline transaction carries a stable device id so the cloud can tell
// which terminal produced it. The tenant guard makes sure a cached mirror is
// never visible to a user from a different tenant: if the active tenant (or
// user) changes on this device, the local mirror is wiped before use.

import { db } from "./db";

const DEVICE_KEY = "tillix_device_id";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Stable per-browser device id. Safe to call on every write. */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = uuid();
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "unknown-device";
  }
}

/** Meta row helpers (persisted inside IndexedDB, not localStorage). */
export async function getMeta<T = any>(key: string): Promise<T | null> {
  try {
    const row = await db()._meta.get(key);
    return (row?.value as T) ?? null;
  } catch {
    return null;
  }
}
export async function setMeta(key: string, value: any): Promise<void> {
  try {
    await db()._meta.put({ key, value });
  } catch {
    /* best effort */
  }
}

/**
 * Ensure the local mirror belongs to the given tenant + user.
 * Returns true when the mirror was wiped (caller should re-sync).
 */
export async function guardTenantScope(tenantId: string | null, userId: string | null): Promise<boolean> {
  const prevTenant = await getMeta<string>("tenant_id");
  const prevUser = await getMeta<string>("user_id");
  const changed =
    (prevTenant && tenantId && prevTenant !== tenantId) ||
    (prevUser && userId && prevUser !== userId);

  if (changed) {
    const { wipeLocalMirror } = await import("./sync");
    const { resetLocalFirstSession } = await import("./data-access");
    await wipeLocalMirror();
    resetLocalFirstSession();
  }
  if (tenantId) await setMeta("tenant_id", tenantId);
  if (userId) await setMeta("user_id", userId);
  return !!changed;
}

/** Called on sign-out — removes cached business data from this device. */
export async function clearOfflineDataOnLogout(opts: { includeQueue?: boolean } = { includeQueue: true }): Promise<void> {
  try {
    const { wipeLocalMirror } = await import("./sync");
    const { resetLocalFirstSession } = await import("./data-access");
    // Only wipe the queue if includeQueue is explicitly true
    await wipeLocalMirror({ includeQueue: opts.includeQueue });
    resetLocalFirstSession();
    
    // We only clear tenant/user meta if we're also clearing the queue.
    // If we preserve the queue, we must keep these so a return sync knows whose they are.
    if (opts.includeQueue) {
      await setMeta("tenant_id", null);
      await setMeta("user_id", null);
      try {
        window.localStorage.removeItem("tillix_offline_auth_user");
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* never block sign-out */
  }
}

