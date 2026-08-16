import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { logAppError } from "../lib/log-app-error";
import { AppErrorBoundary } from "../components/error-boundary";
import { SuspendedGate } from "../components/suspended-gate";
import { useEnterAsClick } from "../hooks/use-enter-as-click";
import { useSessionHeartbeat } from "../hooks/use-session-heartbeat";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
    void logAppError({
      errorType: "route_error",
      errorMessage: error.message || "Route render error",
      stackTrace: error.stack ?? null,
    });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Tillix – Smart Retail Starts Here | Cloud POS & Retail Management" },
      { name: "description", content: "Tillix is a cloud POS and retail management platform for grocery, supermarkets, pharmacies, restaurants and multi-store businesses. Billing, inventory, barcodes, loyalty and analytics in one." },
      { name: "theme-color", content: "#0b1220" },
      { property: "og:site_name", content: "Tillix" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    scripts: [
      {
        children:
          "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-NWDSC98L');",
      },
      { src: "https://www.googletagmanager.com/gtag/js?id=G-4S0EN9MXJW", async: true },
      {
        children:
          "window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', 'G-4S0EN9MXJW');",
      },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/favicon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEnterAsClick();
  useSessionHeartbeat();

  // Recover once from stale route chunks after a new deployment.
  useEffect(() => {
    installChunkRecovery();
  }, []);


  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const { bootOfflineStatus, getOfflineStatus } = await import("@/lib/offline/status");
        const { runSync, recoverInterruptedQueue, scheduleRetryPass } = await import("@/lib/offline/sync");
        const { registerAppShellSW } = await import("@/lib/offline/register-sw");
        const { debounceAsync, logPerf, nowMs, whenIdle } = await import("@/lib/offline/perf");
        if (disposed) return;
        bootOfflineStatus();
        void registerAppShellSW();
        // Resume any upload interrupted by a crash / power failure, then arm
        // the backoff timer for items still waiting on a retry window.
        await recoverInterruptedQueue();
        void scheduleRetryPass();

        const trigger = (reason: string) => {
          const s = getOfflineStatus();
          if (!s.enabled || !s.online) return;
          void runSync({ silent: true, reason });
        };

        // Boot sync waits for the first idle window so the POS shell paints and
        // becomes interactive before any network/IndexedDB work starts.
        void (async () => {
          await whenIdle(1500);
          if (!disposed) trigger("boot");
        })();

        // Reconnect can fire several `online` events (Wi-Fi flap, VPN, captive
        // portal). Debounce so only one sync pass runs, and never sooner than
        // 10s after the previous reconnect-triggered pass.
        let offlineSince: number | null = null;
        const debouncedReconnectSync = debounceAsync(() => trigger("reconnect"), 2500, 10_000);
        const onOnline = () => {
          if (offlineSince !== null) {
            logPerf("reconnected", { offlineForMs: Math.round(nowMs() - offlineSince) });
            offlineSince = null;
          }
          debouncedReconnectSync();
        };
        const onOffline = () => { offlineSince = nowMs(); };
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);

        const interval = window.setInterval(() => trigger("interval"), 5 * 60_000);

        // Returning to the tab (or app resume on desktop) is also a good moment
        // to drain the queue — some platforms never fire an `online` event.
        const onVisible = () => { if (document.visibilityState === "visible") debouncedReconnectSync(); };
        document.addEventListener("visibilitychange", onVisible);

        cleanup = () => {
          window.removeEventListener("online", onOnline);
          window.removeEventListener("offline", onOffline);
          document.removeEventListener("visibilitychange", onVisible);
          window.clearInterval(interval);
        };
        if (disposed) cleanup();
      } catch {/* SSR / unsupported */}
    })();

    return () => { disposed = true; cleanup?.(); };
  }, []);



  return (
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary module="root">
        <SuspendedGate>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </SuspendedGate>
      </AppErrorBoundary>
    </QueryClientProvider>
  );
}

