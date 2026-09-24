import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import { readLocalFirst } from "@/lib/offline/data-access";
import { db } from "@/lib/offline/db";

type MyAccess = { isAdmin: boolean; isSuperAdmin: boolean; perms: Set<string>; tenantStatus: string | null };

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
  { key: "stock-count", label: "Stock count" },
  { key: "expiry", label: "Expiry & waste" },
  { key: "intelligence", label: "Inventory intelligence" },
  { key: "library", label: "Global product library" },
  { key: "assets", label: "Shop assets" },
  { key: "barcode-generator", label: "Barcode generator" },
  { key: "cash-flow", label: "Cash flow" },
  { key: "reports", label: "Reports / P&L" },
  { key: "shifts", label: "Shifts & cash drawer" },
  { key: "operations", label: "Business operations" },
  { key: "backup", label: "Auto backup" },
  { key: "settings", label: "Store settings" },
] as const;

// While a shop is pending approval, restrict the owner to bare essentials only.
const PENDING_PERMS = new Set(["pos", "sales", "dashboard", "library"]);

export function usePermissions() {
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["my-access", user?.id],
    enabled: !!user?.id,
    queryFn: () =>
      readLocalFirst<MyAccess>({
        table: "my_access",
        cloud: async () => {
          const [rolesRes, permsRes, statusRes] = await Promise.all([
            supabase.from("user_roles").select("role").eq("user_id", user!.id),
            supabase.from("user_permissions").select("perm").eq("user_id", user!.id),
            supabase.rpc("my_tenant_status"),
          ]);
          if (rolesRes.error) throw rolesRes.error;
          if (permsRes.error) throw permsRes.error;
          const { data: tenantMemberships, error: tenantMembershipsError } = await supabase
            .from("tenant_members")
            .select("role")
            .eq("user_id", user!.id);
          if (tenantMembershipsError) throw tenantMembershipsError;
          const isTenantAdmin = (tenantMemberships ?? []).some((m) => m.role === "owner" || m.role === "admin");
          const isAdmin = isTenantAdmin || (rolesRes.data ?? []).some((r) => r.role === "admin");
          const isSuperAdmin = (rolesRes.data ?? []).some((r) => r.role === "super_admin");
          const granted = new Set((permsRes.data ?? []).map((p) => p.perm));
          const tenantStatus = (statusRes.data as string | null) ?? null;
          return { isAdmin, isSuperAdmin, perms: granted, tenantStatus };
        },
        local: async () => {
          const row = await db().my_access.get("me");
          if (!row) return null as unknown as MyAccess;
          return {
            isAdmin: row.isAdmin,
            isSuperAdmin: row.isSuperAdmin,
            tenantStatus: row.tenantStatus,
            perms: new Set<string>(row.perms ?? []),
          };
        },
        cache: async (data) => {
          await db().my_access.put({
            id: "me",
            isAdmin: data.isAdmin,
            isSuperAdmin: data.isSuperAdmin,
            tenantStatus: data.tenantStatus,
            perms: Array.from(data.perms),
          });
        },
        isEmpty: (data) => !data,
        onRevalidated: (fresh) => qc.setQueryData(["my-access", user?.id], fresh),
      }),
  });
  const isAdmin = q.data?.isAdmin ?? false;
  const isSuperAdmin = q.data?.isSuperAdmin ?? false;
  const tenantStatus = q.data?.tenantStatus ?? null;
  const isPending = tenantStatus === "pending";

  const can = (perm: string) => {
    // Developer / super-admin always sees everything.
    if (isSuperAdmin) return true;
    // Pending shops: only basic modules are usable until approved.
    if (isPending) return PENDING_PERMS.has(perm);
    if (isAdmin) return true;
    if (perm === "pos" || perm === "sales" || perm === "library") return true;
    return q.data?.perms.has(perm) ?? false;
  };
  return { isAdmin, isSuperAdmin, isPending, tenantStatus, can, loading: authLoading || q.isLoading };
}
