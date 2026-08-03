// Guarded service-worker registration. Runs only in the deployed production
// app — never inside the Lovable editor / preview iframe / dev server.
// Provides `?sw=off` kill-switch that unregisters existing SWs.

const SW_PATH = "/sw.js";

function isRefusedHost(hostname: string): boolean {
  if (hostname.startsWith("id-preview--") || hostname.startsWith("preview--")) return true;
  if (hostname === "lovableproject.com" || hostname.endsWith(".lovableproject.com")) return true;
  if (hostname === "lovableproject-dev.com" || hostname.endsWith(".lovableproject-dev.com")) return true;
  if (hostname === "beta.lovable.dev" || hostname.endsWith(".beta.lovable.dev")) return true;
  return false;
}

async function unregisterMatching(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(
      regs
        .filter((r) => {
          const url = r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL ?? "";
          return url.endsWith(SW_PATH);
        })
        .map((r) => r.unregister()),
    );
  } catch { /* ignore */ }
}

// Pages that must open from a bookmark with no internet.
const WARM_ROUTES = ["/", "/pos", "/sales", "/sale-returns", "/auth"];
const WARM_KEY = "tillix:nav-warm-at";

/** Pre-fills the service worker's navigation cache so a bookmarked URL opens
 *  offline. Uses a hidden iframe because Workbox only caches requests whose
 *  mode is "navigate" — a plain fetch() would never match that route. */
async function warmNavigationCache(): Promise<void> {
  try {
    const last = Number(window.localStorage.getItem(WARM_KEY) ?? 0);
    if (Date.now() - last < 12 * 60 * 60 * 1000) return;

    await navigator.serviceWorker.ready;

    for (const route of WARM_ROUTES) {
      await new Promise<void>((resolve) => {
        const frame = document.createElement("iframe");
        frame.setAttribute("aria-hidden", "true");
        frame.style.cssText =
          "position:fixed;left:-10000px;top:-10000px;width:1024px;height:768px;border:0;opacity:0;pointer-events:none";
        const done = () => {
          try { frame.remove(); } catch { /* ignore */ }
          resolve();
        };
        frame.addEventListener("load", () => window.setTimeout(done, 300), { once: true });
        frame.addEventListener("error", done, { once: true });
        window.setTimeout(done, 8000);
        frame.src = `${route}${route.includes("?") ? "&" : "?"}warm=1`;
        document.body.appendChild(frame);
      });
    }

    window.localStorage.setItem(WARM_KEY, String(Date.now()));
  } catch { /* best effort */ }
}

export async function registerAppShellSW(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
  const url = new URL(window.location.href);
  const swOff = url.searchParams.get("sw") === "off";
  const isDev = !import.meta.env.PROD;
  const refusedHost = isRefusedHost(window.location.hostname);

  if (isDev || inIframe || refusedHost || swOff) {
    await unregisterMatching();
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
    if (registration.installing || registration.waiting || registration.active) {
      // Keep the app shell durable on first install.
      await registration.update();
    }
    // Don't warm from inside a warm iframe (avoids recursion).
    if (!url.searchParams.has("warm")) {
      void warmNavigationCache();
    }
  } catch {
    // Ignore registration failures; offline mode still works if the app is already cached.
  }
}
