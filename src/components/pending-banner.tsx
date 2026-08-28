import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useSuperAdmin } from "@/hooks/use-super-admin";

export function PendingBanner() {
  const { user } = useAuth();
  const { isSuperAdmin } = useSuperAdmin();
  const { data: status } = useQuery({
    queryKey: ["my-tenant-status", user?.id],
    enabled: !!user?.id && !isSuperAdmin,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_tenant_status");
      if (error) return null;
      return (data as string | null) ?? null;
    },
  });

  const isLive = !isSuperAdmin && status !== "pending" && status !== "suspended" && status !== "archived" && status !== "expired";
  const { data: trial } = useQuery({
    queryKey: ["my-trial-info", user?.id],
    enabled: !!user?.id && isLive,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_trial_info");
      if (error) return null;
      return data as { status: string; expires_at: string } | null;
    },
  });

  if (isSuperAdmin) return null;

  if (status === "pending") {
    return (
      <div className="w-full bg-amber-500/15 border-b border-amber-500/30 text-amber-900 dark:text-amber-100 text-[11px] sm:text-xs px-3 py-2 flex items-start sm:items-center gap-2 no-print">
        <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5 sm:mt-0" />
        <span className="min-w-0 leading-snug">
          Your shop is <strong>pending approval</strong>. You have limited access (POS &amp; Sales) until the developer approves it.
        </span>
      </div>
    );
  }

  if (trial?.expires_at) {
    const daysLeft = Math.max(0, Math.ceil((new Date(trial.expires_at).getTime() - Date.now()) / 86_400_000));
    return (
      <div className="w-full bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-900 dark:text-emerald-100 text-[11px] sm:text-xs px-3 py-2 flex items-start sm:items-center gap-2 no-print">
        <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5 sm:mt-0" />
        <span className="min-w-0 leading-snug">
          <strong>{daysLeft} day{daysLeft === 1 ? "" : "s"}</strong> left in your free trial. Contact tillix.co support to upgrade and keep full access.
        </span>
      </div>
    );
  }

  return null;
}
