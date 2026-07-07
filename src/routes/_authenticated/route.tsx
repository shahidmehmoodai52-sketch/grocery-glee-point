import { createFileRoute, Outlet, redirect, useRouter, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { maybeRunDaily } from "@/lib/backup";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { RouteGuard } from "@/components/route-guard";
import { LowStockAlerts } from "@/components/low-stock-alerts";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { next: location.pathname + location.searchStr } });
    }
    return { user: data.user };
  },
  component: Layout,
  errorComponent: AuthedError,
  notFoundComponent: AuthedNotFound,
});

function Layout() {
  useEffect(() => { maybeRunDaily(); }, []);
  useRealtimeSync();
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center border-b bg-card/50 backdrop-blur px-2 no-print">
            <SidebarTrigger />
          </header>
          <LowStockAlerts />
          <main className="flex-1 min-w-0 overflow-auto">
            <RouteGuard><Outlet /></RouteGuard>
          </main>
        </div>
        <Toaster richColors position="top-right" duration={4000} closeButton />
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
