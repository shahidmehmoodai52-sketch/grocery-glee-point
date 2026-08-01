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
  } catch {
    // Ignore registration failures; offline mode still works if the app is already cached.
  }
}
