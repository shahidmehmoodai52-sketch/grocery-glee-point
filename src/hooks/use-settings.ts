import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setDefaultCurrencySymbol } from "@/lib/format";

export function useSettings() {
  const q = useQuery({
    queryKey: ["store_settings"],
    queryFn: async () => {
      // Tenant-safe: my_store_settings() returns the row for the current tenant.
      const { data, error } = await supabase.rpc("my_store_settings");
      if (error) throw error;
      return Array.isArray(data) ? data[0] ?? null : data ?? null;
    },
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Keep the global fmtMoney default in sync everywhere useSettings is used,
  // so any component using fmtMoney() without an explicit symbol still updates
  // the instant currency settings change.
  const sym = (q.data as any)?.currency_symbol;
  useEffect(() => {
    if (sym) setDefaultCurrencySymbol(sym);
  }, [sym]);

  return q;
}
