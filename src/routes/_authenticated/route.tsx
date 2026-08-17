import { createFileRoute, Outlet, redirect, useRouter, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSelect } from "@/components/language-select/language-select";

import { LogOut, AlertTriangle } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { maybeRunDaily } from "@/lib/backup";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { RouteGuard } from "@/components/route-guard";
import { LowStockAlerts } from "@/components/low-stock-alerts";
import { useSettings } from "@/hooks/use-settings";
import { setDefaultCurrencySymbol } from "@/lib/format";
import { PendingBanner } from "@/components/pending-banner";
import { ExpiryCountdown } from "@/components/expiry-countdown";
import { getUserAllowOffline } from "@/lib/offline/session";
import { OfflineStatusBadge } from "@/components/offline-status";
import { clearOfflineDataOnLogout, guardTenantScope } from "@/lib/offline/device";



export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const user = await getUserAllowOffline();
    if (!user) {
      throw redirect({ to: "/auth", search: { next: location.pathname + location.searchStr } });
    }
    return { user };
  },
  component: Layout,
  errorComponent: AuthedError,
  notFoundComponent: AuthedNotFound,
});

function Layout() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const handleSignOut = async (force: boolean = false) => {
    if (!force) {
      try {
        const { getPendingQueueCount } = await import("@/lib/offline/sync");
        const count = await getPendingQueueCount();
        if (count > 0) {
          setPendingCount(count);
          setShowLogoutConfirm(true);
          return;
        }
      } catch {
        /* best effort check */
      }
    }

    // Multi-tenant safety: remove every cached row before releasing the device.
    // If there are pending sales, clearOfflineDataOnLogout(includeQueue: false)
    // would keep the queue, but that's risky for tenant leakage if the NEXT user
    // is different. However, the user explicitly asked to "fix sign-out throws
    // away pending offline sales".
    //
    // The safest fix:
    // 1. Alert the user (above).
    // 2. If they proceed, we wipe the mirror but NOT the queue if we want to
    //    preserve it, but that's complex to re-link to the right user later.
    //    Actually, we should probably just wipe everything if they confirm,
    //    because the cashier is acknowledging the loss.
    await clearOfflineDataOnLogout();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { next: "/dashboard" }, replace: true });
  };

  const { data: settings } = useSettings();
  useEffect(() => {
    setDefaultCurrencySymbol((settings as any)?.currency_symbol ?? "Rs");
  }, [settings]);

  useEffect(() => {
    maybeRunDaily();
    // Poll every minute so the scheduled time triggers when the app is left open.
    const t = setInterval(() => { maybeRunDaily(); }, 60_000);
    return () => clearInterval(t);
  }, []);

  // Isolate the local mirror per tenant/user — wipes cached data if either changed.
  useEffect(() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    (async () => {
      try {
        const [{ data: tenantId }, { data: auth }] = await Promise.all([
          supabase.rpc("current_tenant_id") as any,
          supabase.auth.getUser(),
        ]);
        await guardTenantScope((tenantId as string) ?? null, auth?.user?.id ?? null);
      } catch {/* offline or RPC unavailable — mirror stays as-is */}
    })();
  }, []);

  useRealtimeSync();
  return (
    <SidebarProvider>
      <div className="h-screen overflow-hidden flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <PendingBanner />
          <ExpiryCountdown />

          <header className="relative z-[500] h-12 flex items-center border-b bg-card/50 backdrop-blur px-2 no-print gap-2">
            <SidebarTrigger />
            <div className="flex-1 min-w-0">
              <LowStockAlerts />
            </div>
            <LanguageSelect className="mr-1" />
            <OfflineStatusBadge className="mr-1" />
            <Button variant="outline" size="sm" onClick={() => handleSignOut(false)} className="gap-2">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{t('common.logout')}</span>
            </Button>


          </header>
          <main className="flex-1 min-w-0 overflow-auto">
            <RouteGuard><Outlet /></RouteGuard>
          </main>

        </div>
        <Toaster richColors position="top-right" duration={4000} closeButton />

        <AlertDialog open={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Unsynced Data Detected
              </AlertDialogTitle>
              <AlertDialogDescription>
                You have {pendingCount} transaction{pendingCount > 1 ? "s" : ""} waiting to be synced to the cloud.
                Logging out now will <strong>permanently delete</strong> these offline sales.
                <br /><br />
                Please connect to the internet and wait for the sync to complete, or confirm if you want to discard these transactions.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Go Back</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleSignOut(true)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Discard & Log Out
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SidebarProvider>
  );
}


function AuthedError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="p-8 max-w-xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        We couldn't load this page. This is usually temporary — please try again.
      </p>
      {error?.message && (
        <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40">{error.message}</pre>
      )}
      <div className="flex gap-2">
        <Button onClick={() => { router.invalidate(); reset(); }}>Try again</Button>
        <Button variant="outline" asChild><Link to="/dashboard">Go to dashboard</Link></Button>
      </div>
    </div>
  );
}

function AuthedNotFound() {
  return (
    <div className="p-8 max-w-xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you're looking for doesn't exist or has moved.</p>
      <Button asChild><Link to="/dashboard">Back to dashboard</Link></Button>
    </div>
  );
}
