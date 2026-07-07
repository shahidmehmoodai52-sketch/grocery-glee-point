import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useSettings() {
  return useQuery({
    queryKey: ["store_settings"],
    queryFn: async () => {
      // Tenant-safe: my_store_settings() returns the row for the current tenant.
      const { data, error } = await supabase.rpc("my_store_settings");
      if (error) throw error;
      return Array.isArray(data) ? data[0] ?? null : data ?? null;
    },
    staleTime: 60_000,
  });
}
