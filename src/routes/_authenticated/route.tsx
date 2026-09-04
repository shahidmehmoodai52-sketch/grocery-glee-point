import { createFileRoute, Outlet, redirect, useRouter, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
import { SuspendedGate } from "@/components/suspended-gate";



export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const user = await getUserAllowOffline();
    if (!user) {
      throw redirect({ to: "/auth", search: { next: location.pathname + location.searchStr } });
    }

    // Block admin staff from shop routes and force them to the admin panel
    const { data: isAdmin } = await supabase.rpc("am_i_admin_staff");
    if (isAdmin) {
      throw redirect({ to: "/admin" });
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
    let hasPending = false;
    try {
      const { getPendingQueueCount } = await import("@/lib/offline/sync");
      const count = await getPendingQueueCount();
      if (count > 0) {
        hasPending = true;
        if (!force) {
          setPendingCount(count);
          setShowLogoutConfirm(true);
          return;
        }
      }
    } catch {
      /* best effort check */
    }

    // If force is true, we wipe everything including the queue.
    // If there is NO pending data, we wipe everything safely.
    // If the user cancelled the dialog (force=false), we don't even reach here.
    await clearOfflineDataOnLogout({ includeQueue: force || !hasPending });
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
      <SuspendedGate>
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
                  {t('common.unsynced_data_title', 'Unsynced Data Detected')}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t(pendingCount > 1 ? 'common.unsynced_data_count_other' : 'common.unsynced_data_count_one',
                    pendingCount > 1
                      ? 'You have {{count}} transactions waiting to be synced to the cloud.'
                      : 'You have {{count}} transaction waiting to be synced to the cloud.',
                    { count: pendingCount })}
                  {' '}
                  <Trans
                    i18nKey="common.unsynced_data_warning"
                    defaults="Logging out now will <b>permanently delete</b> these offline sales."
                    components={{ b: <strong /> }}
                  />
                  <br /><br />
                  {t('common.unsynced_data_instructions', 'Please connect to the internet and wait for the sync to complete, or confirm if you want to discard these transactions.')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.go_back', 'Go Back')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleSignOut(true)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t('common.discard_and_log_out', 'Discard & Log Out')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SuspendedGate>
    </SidebarProvider>
  );
}


function AuthedError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <div className="p-8 max-w-xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold">{t('common.something_went_wrong', 'Something went wrong')}</h1>
      <p className="text-sm text-muted-foreground">
        {t('common.load_error_desc', "We couldn't load this page. This is usually temporary — please try again.")}
      </p>
      {error?.message && (
        <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40">{error.message}</pre>
      )}
      <div className="flex gap-2">
        <Button onClick={() => { router.invalidate(); reset(); }}>{t('common.try_again', 'Try again')}</Button>
        <Button variant="outline" asChild><Link to="/dashboard">{t('common.go_to_dashboard', 'Go to dashboard')}</Link></Button>
      </div>
    </div>
  );
}

function AuthedNotFound() {
  const { t } = useTranslation();
  return (
    <div className="p-8 max-w-xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold">{t('common.page_not_found', 'Page not found')}</h1>
      <p className="text-sm text-muted-foreground">{t('common.page_not_found_desc', "The page you're looking for doesn't exist or has moved.")}</p>
      <Button asChild><Link to="/dashboard">{t('common.back_to_dashboard', 'Back to dashboard')}</Link></Button>
    </div>
  );
}
