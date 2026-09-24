// Device identity + tenant isolation for the offline mirror.
//
// Every offline transaction carries a stable device id so the cloud can tell
// which terminal produced it. The tenant guard makes sure a cached mirror is
// never visible to a user from a different tenant: if the active tenant (or
// user) changes on this device, the cached READ mirror (products, customers,
// ...) is wiped before use. The offline WRITE queue is never touched by this
// automatic guard — see guardTenantScope() below for why.

import { db } from "./db";

const DEVICE_KEY = "tillix_device_id";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Asks the browser to mark this origin's storage (IndexedDB, localStorage)
 *  as "persistent" instead of "best-effort" — the category Chrome/Firefox
 *  are allowed to silently evict under disk pressure without ever asking
 *  the user (this is the more common real-world cause of an offline mirror
 *  going empty, more than someone deliberately clearing site data). It
 *  cannot stop a user from clearing their own browser data on purpose —
 *  no site can override that — but it does remove the silent-eviction
 *  risk, and on Chromium a site with a history of user engagement is
 *  granted this automatically without even a permission prompt. Safe to
 *  call every boot: a no-op once already granted. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    const already = await navigator.storage.persisted?.();
    if (already) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
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
 * Returns true when the read mirror was wiped (caller should re-sync).
 *
 * This runs automatically in the background on every authenticated page
 * load (see _authenticated/route.tsx), from values read fresh off the
 * network (current_tenant_id() RPC, auth.getUser()) — so it can fire from a
 * stale/transient read (a session hiccup right as connectivity returns, a
 * device previously shared by a different staff login, etc.), not only from
 * a genuine, deliberate tenant/user switch. Because of that, it must NEVER
 * be allowed to silently destroy unsynced offline writes: a real incident
 * (Hafiz Mart, 2026-09-24) lost 7 already-completed but not-yet-synced
 * sales this way — the automatic guard fired mid-reconnect, wiped the
 * mirror including the write queue with `includeQueue` defaulting to true,
 * and the cashier never saw any warning.
 *
 * So this only ever wipes the cached READ mirror (products, customers,
 * ...), which is safe to lose — it just re-downloads. The write queue is
 * left alone: each queued item already carries its own tenant_id captured
 * at enqueue time, so it keeps draining correctly regardless of what this
 * check decides afterward. If there was anything queued when a scope change
 * fires, the user is told about it (toast) instead of it happening
 * invisibly — only an explicit sign-out (clearOfflineDataOnLogout, which
 * already confirms with the user first when something is pending) is
 * allowed to actually discard the queue.
 */
export async function guardTenantScope(tenantId: string | null, userId: string | null): Promise<boolean> {
  const prevTenant = await getMeta<string>("tenant_id");
  const prevUser = await getMeta<string>("user_id");
  const changed =
    (prevTenant && tenantId && prevTenant !== tenantId) ||
    (prevUser && userId && prevUser !== userId);

  if (changed) {
    const { wipeLocalMirror, getPendingQueueCount } = await import("./sync");
    const { resetLocalFirstSession } = await import("./data-access");
    const pending = await getPendingQueueCount().catch(() => 0);
    await wipeLocalMirror({ includeQueue: false });
    resetLocalFirstSession();
    if (pending > 0) {
      try {
        const { toast } = await import("sonner");
        toast.warning(
          `This device switched account/shop — ${pending} unsynced sale${pending > 1 ? "s" : ""} were kept safe and will sync automatically once online.`,
          { duration: 10000 },
        );
      } catch {
        /* best effort */
      }
    }
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
    
    // Safety check: Never wipe the queue unless explicitly instructed.
    // This allows the user to log out and log back in without losing pending sales.
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

