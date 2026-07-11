import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/use-permissions";

export function usePriceVisibility() {
  const { isSuperAdmin, loading } = usePermissions();

  return useQuery({
    queryKey: ["tenant-price-visibility", isSuperAdmin],
    enabled: !loading,
    queryFn: async () => {
      if (isSuperAdmin) return { hasAccess: true, showSell: true, showCost: true };

      const { data: tenantId, error: tenantError } = await supabase.rpc("current_tenant_id");
      if (tenantError) throw tenantError;
      if (!tenantId) return { hasAccess: false, showSell: false, showCost: false };

      const { data, error } = await supabase
        .from("tenants")
        .select("library_approved, library_show_sell_price, library_show_cost_price")
        .eq("id", tenantId as string)
        .maybeSingle();
      if (error) throw error;

      return {
        hasAccess: !!data?.library_approved,
        showSell: data?.library_show_sell_price ?? true,
        showCost: data?.library_show_cost_price ?? true,
      };
    },
    staleTime: 10_000,
  });
}