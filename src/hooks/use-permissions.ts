import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export const ALL_PERMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "sales", label: "Sales history" },
  { key: "sale-returns", label: "Sale returns" },
  { key: "purchases", label: "Purchases" },
  { key: "purchase-returns", label: "Purchase returns" },
  { key: "expenses", label: "Expenses" },
  { key: "products", label: "Products" },
  { key: "customers", label: "Customers" },
  { key: "suppliers", label: "Suppliers" },
  { key: "import", label: "Bulk import" },
  { key: "reports", label: "Reports / P&L" },
  { key: "backup", label: "Auto backup" },
  { key: "settings", label: "Store settings" },
] as const;

export function usePermissions() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["my-access", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [{ data: roles }, { data: perms }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user!.id),
        supabase.from("user_permissions").select("perm").eq("user_id", user!.id),
      ]);
      const isAdmin = (roles ?? []).some((r) => r.role === "admin");
      const granted = new Set((perms ?? []).map((p) => p.perm));
      return { isAdmin, perms: granted };
    },
  });
  const isAdmin = q.data?.isAdmin ?? false;
  // POS + Sales are always allowed; everything else requires admin or grant
  const can = (perm: string) => {
    if (isAdmin) return true;
    if (perm === "pos" || perm === "sales") return true;
    return q.data?.perms.has(perm) ?? false;
  };
  return { isAdmin, can, loading: q.isLoading };
}
