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

  useEffect(() => {
    // Boot offline layer (safe no-op if disabled / unsupported).
    (async () => {
      try {
        const { bootOfflineStatus, getOfflineStatus } = await import("@/lib/offline/status");
        const { runSync } = await import("@/lib/offline/sync");
        const { registerAppShellSW } = await import("@/lib/offline/register-sw");
        bootOfflineStatus();
        void registerAppShellSW();

        // Attempt an immediate boot-time sync with a few retries so queued writes
        // are flushed as soon as connectivity is available after app startup.
        const attemptBootSync = async () => {
          const maxAttempts = 5;
          for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const s = getOfflineStatus();
            if (s.enabled && s.online) {
              try {
                await runSync({ silent: true });
                break;
              } catch {
                // swallow and retry with backoff
              }
            }
            // exponential-ish backoff (1s, 3s, 5s, ...)
            const waitMs = 1000 * Math.min(1 + attempt * 2, 10);
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, waitMs));
          }
        };
        void attemptBootSync();

        const onOnline = () => { if (getOfflineStatus().enabled) void runSync({ silent: true }); };
        window.addEventListener("online", onOnline);
        const interval = window.setInterval(() => {
          if (getOfflineStatus().enabled && getOfflineStatus().online) void runSync({ silent: true });
        }, 5 * 60_000);
        return () => { window.removeEventListener("online", onOnline); window.clearInterval(interval); };
      } catch {/* SSR / unsupported */}
    })();
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

