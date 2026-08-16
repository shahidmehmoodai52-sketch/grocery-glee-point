/**
 * Stale-chunk recovery.
 *
 * After a new deployment the previously hashed route chunks (e.g.
 * /assets/pos-XXXX.js) no longer exist. A browser that still holds the old
 * HTML — from its own cache, from the service worker's "html-nav" cache, or
 * from an already-open tab — will try to lazily import a filename that is
 * gone and the route dies with:
 *
 *   Failed to fetch dynamically imported module: https://…/assets/route-….js
 *
 * This module detects that specific failure and recovers ONCE: it drops the
 * service-worker caches (so the next navigation gets fresh HTML + assets),
 * then hard-reloads. A sessionStorage stamp makes a reload loop impossible —
 * one recovery per tab per 60s window, after which the normal error UI shows.
 *
 * No application/business logic is touched.
 */

const FLAG = "tillix:chunk-recovered-at";
const COOLDOWN_MS = 60_000;

const CHUNK_ERROR_RE =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|loading chunk [\d\w]+ failed|failed to load module script/i;

export function isChunkLoadError(reason: unknown): boolean {
  const message =
    typeof reason === "string"
      ? reason
      : reason && typeof reason === "object"
        ? String((reason as { message?: unknown }).message ?? "")
        : "";
  if (!message) return false;
  if (String((reason as { name?: unknown })?.name ?? "") === "ChunkLoadError") return true;
  return CHUNK_ERROR_RE.test(message);
}

function recoveredRecently(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(FLAG) ?? 0);
    return Number.isFinite(last) && Date.now() - last < COOLDOWN_MS;
  } catch {
    // Without sessionStorage we cannot guard against a loop — never reload.
    return true;
  }
}

/** Returns true when a recovery reload was started. */
export function recoverFromChunkError(): boolean {
  if (typeof window === "undefined") return false;
  if (recoveredRecently()) return false;
  try {
    window.sessionStorage.setItem(FLAG, String(Date.now()));
  } catch {
    return false;
  }

  void (async () => {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        // Only the app-shell caches; IndexedDB / offline POS data is untouched.
        await Promise.allSettled(
          keys.filter((k) => /workbox|precache|html-nav|static-assets/i.test(k)).map((k) => caches.delete(k)),
        );
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.allSettled(regs.map((r) => r.update().catch(() => undefined)));
      }
    } catch {
      // best effort
    } finally {
      window.location.reload();
    }
  })();

  return true;
}

let installed = false;

/** Installs global listeners for failed lazy route imports. Call once. */
export function installChunkRecovery(): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  window.addEventListener("error", (event) => {
    if (isChunkLoadError(event.error ?? event.message)) recoverFromChunkError();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) recoverFromChunkError();
  });
}
