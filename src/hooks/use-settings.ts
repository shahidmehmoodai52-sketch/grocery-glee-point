import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useSettings() {
  return useQuery({
    queryKey: ["store_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("store_settings").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}
