import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export function useSuperAdmin() {
  const { user, loading } = useAuth();
  const q = useQuery({
    queryKey: ["am-i-super-admin", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("am_i_super_admin");
      if (error) throw error;
      return Boolean(data);
    },
  });
  return { isSuperAdmin: q.data === true, loading: loading || q.isLoading };
}
