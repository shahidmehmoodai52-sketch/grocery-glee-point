import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export const ADMIN_PERMS = [
  { key: "shops.view", label: "View shops, errors & security" },
  { key: "shops.approve", label: "Approve / activate shops" },
  { key: "shops.suspend", label: "Suspend / archive shops" },
  { key: "shops.set_expiry", label: "Set shop expiry date" },
  { key: "shops.reset_password", label: "Reset shop owner password" },
  { key: "shops.delete", label: "Delete shops (destructive)" },
] as const;

export function useAdminAccess() {
  const { user, loading } = useAuth();
  const q = useQuery({
    queryKey: ["admin-access", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const [sa, staff, perms] = await Promise.all([
        supabase.rpc("am_i_super_admin"),
        supabase.rpc("am_i_admin_staff"),
        supabase.rpc("my_admin_perms"),
      ]);
      const isSuperAdmin = Boolean(sa.data);
      const isAdminStaff = Boolean(staff.data);
      const permSet = new Set<string>(((perms.data as any[]) ?? []).map((r: any) => r.perm));
      return { isSuperAdmin, isAdminStaff, perms: permSet };
    },
  });
  const isSuperAdmin = q.data?.isSuperAdmin ?? false;
  const isAdminStaff = q.data?.isAdminStaff ?? false;
  const has = (perm: string) => isSuperAdmin || (q.data?.perms.has(perm) ?? false);
  return {
    isSuperAdmin,
    isAdminStaff,
    canEnter: isAdminStaff,
    has,
    perms: q.data?.perms ?? new Set<string>(),
    loading: loading || q.isLoading,
  };
}
