import "@/lib/i18n";
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
import { installChunkRecovery } from "../lib/chunk-recovery";

import { useEnterAsClick } from "../hooks/use-enter-as-click";
import { useSessionHeartbeat } from "../hooks/use-session-heartbeat";
import { supabase } from "../integrations/supabase/client";

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
      { title: "Tillix – Smart Retail Starts Here | Cloud POS & Retail Management Software" },
      { name: "description", content: "Tillix is a modern cloud POS for grocery, supermarkets, retail shops, pharmacies, restaurants, wholesalers and multi-store businesses. Billing, inventory, barcodes, loyalty, suppliers, purchases and real-time analytics in one platform." },
      { name: "theme-color", content: "#0b1220" },
      { property: "og:site_name", content: "Tillix" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Tillix – Smart Retail Starts Here | Cloud POS & Retail Management Software" },
      { name: "twitter:title", content: "Tillix – Smart Retail Starts Here | Cloud POS & Retail Management Software" },
      { property: "og:description", content: "Tillix is a modern cloud POS for grocery, supermarkets, retail shops, pharmacies, restaurants, wholesalers and multi-store businesses. Billing, inventory, barcodes, loyalty, suppliers, purchases and real-time analytics in one platform." },
      { name: "twitter:description", content: "Tillix is a modern cloud POS for grocery, supermarkets, retail shops, pharmacies, restaurants, wholesalers and multi-store businesses. Billing, inventory, barcodes, loyalty, suppliers, purchases and real-time analytics in one platform." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d30009239dc2e80714d9e6903bbb0041/id-preview-c1260d7c--0d8742ce-c858-4431-94b6-b23eb34b18b4.lovable.app-1786896983784.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d30009239dc2e80714d9e6903bbb0041/id-preview-c1260d7c--0d8742ce-c858-4431-94b6-b23eb34b18b4.lovable.app-1786896983784.png" },
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
        // Proper Naskh rendering for the header's Quranic-ayat ticker —
        // system Arabic fonts place diacritics inconsistently, which reads
        // poorly for scripture specifically.
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;600&display=swap",
      },
      {
        // Nastaliq is the calligraphic style Urdu is traditionally set in
        // (the look readers in Pakistan expect) — distinct from the Naskh
        // style above, which is for the Arabic ayat text, not the Urdu
        // translation next to it.
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600&display=swap",
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
    <html>
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
        const {
          bootOfflineStatus,
          getOfflineStatus,
          getSyncMode,
          getSyncIntervalMinutes,
          subscribeOfflineStatus,
        } = await import("@/lib/offline/status");
        const { runSync, recoverInterruptedQueue, scheduleRetryPass } = await import("@/lib/offline/sync");
        const { registerAppShellSW } = await import("@/lib/offline/register-sw");
        const { debounceAsync, logPerf, nowMs, whenIdle } = await import("@/lib/offline/perf");
        const { requestPersistentStorage } = await import("@/lib/offline/device");
        const { refreshSessionDeduped } = await import("@/lib/offline/session");
        if (disposed) return;
        bootOfflineStatus();
        void registerAppShellSW();
        void requestPersistentStorage();
        // Resume any upload interrupted by a crash / power failure, then arm
        // the backoff timer for items still waiting on a retry window.
        await recoverInterruptedQueue();
        void scheduleRetryPass();

        // In "manual"/"scheduled" sync mode the user has deliberately chosen
        // to hold data on this device until an explicit "Sync now" or the
        // scheduled timer below fires — every automatic trigger (boot,
        // reconnect, interval, visibility) becomes a no-op, same as being
        // offline. "realtime" (the default) keeps today's always-on behavior.
        const trigger = (reason: string) => {
          const s = getOfflineStatus();
          if (!s.enabled || !s.online) return;
          if (getSyncMode() !== "realtime") return;
          void runSync({ silent: true, reason });
        };

        // Scheduled mode's own timer, independent of the gate above —
        // re-armed whenever the user changes the mode/interval in Settings
        // instead of only picking up the new value on next app launch.
        let scheduledTimer: number | null = null;
        let armedMode: string | null = null;
        let armedIntervalMinutes: number | null = null;
        const armScheduledTimer = () => {
          const mode = getSyncMode();
          const minutes = getSyncIntervalMinutes();
          if (mode === armedMode && minutes === armedIntervalMinutes) return;
          armedMode = mode;
          armedIntervalMinutes = minutes;
          if (scheduledTimer !== null) {
            window.clearInterval(scheduledTimer);
            scheduledTimer = null;
          }
          if (mode !== "scheduled") return;
          scheduledTimer = window.setInterval(() => {
            const s = getOfflineStatus();
            if (!s.enabled || !s.online || getSyncMode() !== "scheduled") return;
            void runSync({ silent: true, reason: "scheduled" });
          }, minutes * 60_000);
        };
        armScheduledTimer();
        const unsubscribeSyncSettings = subscribeOfflineStatus(() => armScheduledTimer());

        // Boot sync waits for the first idle window so the POS shell paints and
        // becomes interactive before any network/IndexedDB work starts.
        void (async () => {
          await whenIdle(1500);
          if (!disposed) trigger("boot");
        })();

        // Reconnect can fire several `online` events (Wi-Fi flap, VPN, captive
        // portal) — and on a genuinely unstable connection (common on the
        // ISPs this app's Cloudflare proxy exists for), it can keep firing
        // continuously for hours, `visibilitychange` included since it shares
        // this same debounced function. Each pass pulls all ~16 mirrored
        // tables (one request per table), so a 10s floor here meant a flaky
        // connection produced a full sync roughly every 10 seconds, 24/7 —
        // measured as the dominant share of a day's Supabase/Cloudflare
        // request volume on real shops with only a single open tab each.
        // The periodic 5-minute interval below already provides a steady
        // baseline resync, so this only needs to catch "just came back
        // online" reasonably promptly, not instantly — 2 minutes is enough
        // headroom to stop flapping from turning into a request storm.
        // A backgrounded/suspended tab can miss the Supabase client's internal
        // refresh timer, leaving the access token silently expired — the next
        // request then fails with "JWT expired" instead of just working (this
        // hit a real shop while saving an invoice). Force a refresh whenever
        // the app regains focus or the network comes back, so the token is
        // never stale by the time the cashier's next action fires.
        //
        // Uses the shared deduped helper (see session.ts) — onOnline and
        // onVisible below can both fire within milliseconds of each other on
        // a flapping connection, and racing two independent refreshSession()
        // calls can tear down an otherwise-healthy session (see that file's
        // comment for the full explanation).
        const refreshSessionIfNeeded = () => {
          void refreshSessionDeduped();
        };

        let offlineSince: number | null = null;
        const debouncedReconnectSync = debounceAsync(() => trigger("reconnect"), 2500, 120_000);
        const onOnline = () => {
          if (offlineSince !== null) {
            logPerf("reconnected", { offlineForMs: Math.round(nowMs() - offlineSince) });
            offlineSince = null;
          }
          refreshSessionIfNeeded();
          debouncedReconnectSync();
        };
        const onOffline = () => { offlineSince = nowMs(); };
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);

        // A full pass here re-requests every one of the ~34 mirrored tables
        // (pullTable() always issues at least one request per table, even
        // when nothing changed) — while online, the realtime subscription
        // in use-realtime-sync.ts already pushes changes the moment they
        // happen, so this periodic pass is purely a safety-net catch-up for
        // whatever realtime might have missed, not the primary freshness
        // mechanism. At 5 minutes this was ~9,000 needless requests/day per
        // open device even with zero cashier activity — a meaningful share
        // of the whole shop's (and, since the Cloudflare Worker proxy's
        // daily request quota is shared across every tenant, every OTHER
        // shop's) daily budget too. 20 minutes keeps a reasonable catch-up
        // cadence while cutting that idle cost ~4x; boot, reconnect, and a
        // manual "Sync now" are unaffected and stay immediate.
        const interval = window.setInterval(() => trigger("interval"), 20 * 60_000);

        // Returning to the tab (or app resume on desktop) is also a good moment
        // to drain the queue — some platforms never fire an `online` event.
        const onVisible = () => {
          if (document.visibilityState !== "visible") return;
          refreshSessionIfNeeded();
          debouncedReconnectSync();
        };
        document.addEventListener("visibilitychange", onVisible);

        cleanup = () => {
          window.removeEventListener("online", onOnline);
          window.removeEventListener("offline", onOffline);
          document.removeEventListener("visibilitychange", onVisible);
          window.clearInterval(interval);
          if (scheduledTimer !== null) window.clearInterval(scheduledTimer);
          unsubscribeSyncSettings();
        };
        if (disposed) cleanup();
      } catch {/* SSR / unsupported */}
    })();

    return () => { disposed = true; cleanup?.(); };
  }, []);



  return (
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary module="root">
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </AppErrorBoundary>
    </QueryClientProvider>
  );
}

