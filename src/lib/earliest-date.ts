import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Earliest business-activity date for the current tenant (read-only).
 * Used so Dashboard / Reports can default to "day 1 → today" instead of a
 * narrow range that hides all historical data.
 */
export async function fetchEarliestDataDate(): Promise<Date | null> {
  const first = async (table: "sales" | "purchases" | "cash_transactions", col = "created_at") => {
    const { data } = await supabase
      .from(table)
      .select(col)
      .order(col, { ascending: true })
      .limit(1);
    const v = (data?.[0] as any)?.[col];
    return v ? new Date(v) : null;
  };
  const results = await Promise.all([
    first("sales"),
    first("purchases"),
    first("cash_transactions"),
  ]);
  const valid = results.filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
  if (!valid.length) return null;
  return new Date(Math.min(...valid.map((d) => d.getTime())));
}

export function useEarliestDataDate() {
  return useQuery({
    queryKey: ["earliest-data-date"],
    queryFn: fetchEarliestDataDate,
    staleTime: 10 * 60_000,
  });
}
