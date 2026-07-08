import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, LogOut } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useSuperAdmin } from "@/hooks/use-super-admin";
import { Button } from "@/components/ui/button";

export function SuspendedGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isSuperAdmin } = useSuperAdmin();

  const { data: status } = useQuery({
    queryKey: ["my-tenant-status", user?.id],
    enabled: !!user?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_tenant_status");
      if (error) return null;
      return (data as string | null) ?? null;
    },
  });

  // Super-admins always pass through so they can un-suspend from the panel.
  if (isSuperAdmin) return <>{children}</>;

  if (status === "suspended" || status === "archived") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive/5 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertOctagon className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">Shop suspended</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your shop has been {status === "archived" ? "archived" : "suspended"} by the platform administrator. Please
            contact support to restore access.
          </p>
          <Button
            className="mt-6"
            variant="outline"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/auth";
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-lg border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold">Awaiting approval</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your shop is pending admin approval. You'll get access as soon as it's approved.
          </p>
          <Button
            className="mt-6"
            variant="outline"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/auth";
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
