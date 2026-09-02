import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export const ADMIN_PERMS = [
  {
    key: "shops.view",
    label: "View shops, errors & security",
    description: "See the Tenants list, shop details, system errors, and security event logs. Read-only — required for every other shop permission to be useful.",
    group: "Shop management",
  },
  {
    key: "shops.approve",
    label: "Approve / activate shops",
    description: "Move a pending shop to active, or reactivate a suspended one.",
    group: "Shop management",
  },
  {
    key: "shops.suspend",
    label: "Suspend / archive shops",
    description: "Block a shop's staff from signing in, or archive it. Reversible.",
    group: "Shop management",
  },
  {
    key: "shops.set_expiry",
    label: "Set shop expiry date",
    description: "Change a shop's subscription expiry date.",
    group: "Shop management",
  },
  {
    key: "shops.reset_password",
    label: "Reset shop owner password",
    description: "Set a new password for a shop owner who's locked out.",
    group: "Shop management",
  },
  {
    key: "shops.delete",
    label: "Delete shops (destructive)",
    description: "Permanently delete a shop and all its data. Cannot be undone — grant only to fully trusted staff.",
    group: "Shop management",
  },
  {
    key: "library.manage",
    label: "Manage global product library",
    description: "Approve, edit, or remove items in the shared product library that all shops can import from.",
    group: "Global library",
  },
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
