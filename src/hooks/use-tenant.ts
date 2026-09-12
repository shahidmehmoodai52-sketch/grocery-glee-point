import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readLocalFirst } from "@/lib/offline/data-access";
import { db } from "@/lib/offline/db";

export type BusinessType = "grocery" | "pharmacy";

interface TenantInfo {
  id: string;
  name: string;
  business_type: BusinessType;
}

/**
 * The signed-in user's active tenant (id/name/business_type). Local-first via
 * the existing "shops" mirror (already synced from `tenants` with `select("*")`
 * in master-sync.ts, so business_type rides along with no sync-engine changes),
 * falling back to the my_tenant() RPC online.
 */
export function useTenant() {
  return useQuery({
    queryKey: ["tenant", "self"],
    queryFn: async () =>
      readLocalFirst<TenantInfo | null>({
        table: "shops",
        cloud: async () => {
          const { data, error } = await supabase.rpc("my_tenant");
          if (error) throw error;
          const row = Array.isArray(data) ? data[0] : data;
          return (row as TenantInfo) ?? null;
        },
        local: async () => {
          const rows = await db().shops.toArray();
          return (rows?.[0] as TenantInfo) ?? null;
        },
        isEmpty: (row) => !row,
      }),
    staleTime: 5 * 60_000,
  });
}

/** Convenience accessor — defaults to 'grocery' while loading or offline with no cached tenant. */
export function useBusinessType(): BusinessType {
  const { data } = useTenant();
  return data?.business_type ?? "grocery";
}
