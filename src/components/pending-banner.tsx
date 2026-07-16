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

  if (isSuperAdmin || status !== "pending") return null;

  return (
    <div className="w-full bg-amber-500/15 border-b border-amber-500/30 text-amber-900 dark:text-amber-100 text-[11px] sm:text-xs px-3 py-2 flex items-start sm:items-center gap-2 no-print">
      <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5 sm:mt-0" />
      <span className="min-w-0 leading-snug">
        Your shop is <strong>pending approval</strong>. You have limited access (POS &amp; Sales) until the developer approves it.
      </span>
    </div>
  );
}
