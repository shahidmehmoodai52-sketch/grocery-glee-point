import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setDefaultCurrencySymbol } from "@/lib/format";
import { readLocalFirst } from "@/lib/offline/data-access";
import { db } from "@/lib/offline/db";

export function useSettings() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["store_settings"],
    queryFn: async () =>
      // Local-first on cold start only; every later refetch hits the cloud,
      // so saving settings still reflects immediately.
      readLocalFirst<any>({
        table: "store_settings",
        cloud: async () => {
          // Tenant-safe: my_store_settings() returns the row for the current tenant.
          const { data, error } = await supabase.rpc("my_store_settings");
          if (error) throw error;
          return Array.isArray(data) ? data[0] ?? null : data ?? null;
        },
        local: async () => {
          const rows = await db().store_settings.toArray();
          return (rows?.[0] as any) ?? null;
        },
        cache: async (row) => {
          if (row?.id) await db().store_settings.put(row);
        },
        isEmpty: (row) => !row,
        onRevalidated: (fresh) => qc.setQueryData(["store_settings"], fresh),
      }),
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
