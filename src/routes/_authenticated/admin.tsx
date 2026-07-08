import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  Search,
  CheckCircle2,
  Ban,
  Clock,
  Archive,
  Eye,
  Bug,
  Users,
  Store,
  Package,
  ShoppingCart,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSuperAdmin } from "@/hooks/use-super-admin";
import { fmtMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPanelPage,
});

type TenantRow = {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  plan: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  member_count: number;
  product_count: number;
  sales_count: number;
  sales_total: number;
  subscription_status: string | null;
  subscription_expires_at: string | null;
  created_at: string;
};

function AdminPanelPage() {
  const navigate = useNavigate();
  const { isSuperAdmin, loading } = useSuperAdmin();

  useEffect(() => {
    if (!loading && !isSuperAdmin) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, isSuperAdmin, navigate]);

  if (loading) {
    return <div className="p-6"><TableSkeleton rows={6} columns={5} /></div>;
  }
  if (!isSuperAdmin) return null;

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Developer control panel"
        description="Cross-tenant administration for all registered shops."
        icon={<ShieldCheck className="h-5 w-5" />}
      />
      <Tabs defaultValue="tenants">
        <TabsList>
          <TabsTrigger value="tenants"><Store className="h-4 w-4 mr-1" />Tenants</TabsTrigger>
          <TabsTrigger value="errors"><Bug className="h-4 w-4 mr-1" />Errors</TabsTrigger>
        </TabsList>
        <TabsContent value="tenants" className="mt-3"><TenantsTab /></TabsContent>
        <TabsContent value="errors" className="mt-3"><ErrorsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function TenantsTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "pending" | "suspended" | "archived">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_tenants");
      if (error) throw error;
      return (data as TenantRow[]) ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tenants.filter((t) => {
      if (filter !== "all" && t.status !== filter) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        (t.owner_email ?? "").toLowerCase().includes(q) ||
        (t.owner_name ?? "").toLowerCase().includes(q) ||
        (t.slug ?? "").toLowerCase().includes(q)
      );
    });
  }, [tenants, search, filter]);

  const totals = useMemo(() => {
    return {
      total: tenants.length,
      active: tenants.filter((t) => t.status === "active").length,
      pending: tenants.filter((t) => t.status === "pending").length,
      suspended: tenants.filter((t) => t.status === "suspended").length,
      revenue: tenants.reduce((a, t) => a + Number(t.sales_total || 0), 0),
    };
  }, [tenants]);

  const setStatus = async (id: string, status: string, reason?: string) => {
    const { error } = await supabase.rpc("admin_set_tenant_status", {
      _tenant_id: id, _status: status, _reason: reason ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success(`Tenant ${status}`);
    qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    qc.invalidateQueries({ queryKey: ["admin-tenant-detail", id] });
  };

  const suspend = async (id: string, name: string) => {
    const reason = window.prompt(`Suspend "${name}"? Enter reason (visible in audit log):`) ?? "";
    if (!reason) return;
    await setStatus(id, "suspended", reason);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Total shops" value={totals.total} icon={Store} />
        <StatCard title="Active" value={totals.active} icon={CheckCircle2} tone="success" />
        <StatCard title="Pending" value={totals.pending} icon={Clock} tone="warning" />
        <StatCard title="Suspended" value={totals.suspended} icon={Ban} tone="danger" />
      </div>

      <Card className="p-3">
        <div className="flex flex-col md:flex-row gap-2 md:items-center mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search shops by name, owner, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {(["all", "active", "pending", "suspended", "archived"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
              >
                {f}
              </Button>
            ))}
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shop</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Users</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={8} className="py-4"><TableSkeleton rows={5} columns={7} /></TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={8} className="py-8">
                <EmptyState icon={Store} title="No shops match" description="Try clearing filters or search." />
              </TableCell></TableRow>
            )}
            {filtered.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(t.created_at).toLocaleDateString()} · {t.slug ?? "—"}
                  </div>
                </TableCell>
                <TableCell>
                  <div>{t.owner_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{t.owner_email ?? "—"}</div>
                </TableCell>
                <TableCell>
                  {t.status === "active" && <StatusBadge tone="success">Active</StatusBadge>}
                  {t.status === "pending" && <StatusBadge tone="warning">Pending</StatusBadge>}
                  {t.status === "suspended" && <StatusBadge tone="danger">Suspended</StatusBadge>}
                  {t.status === "archived" && <StatusBadge tone="neutral">Archived</StatusBadge>}
                </TableCell>
                <TableCell>
                  <div className="text-sm">{t.plan ?? "—"}</div>
                  {t.subscription_status && (
                    <div className="text-xs text-muted-foreground">{t.subscription_status}</div>
                  )}
                </TableCell>
                <TableCell className="text-right">{t.member_count}</TableCell>
                <TableCell className="text-right">{t.product_count}</TableCell>
                <TableCell className="text-right">
                  <div className="text-sm">{fmtMoney(t.sales_total, "")}</div>
                  <div className="text-xs text-muted-foreground">{t.sales_count} orders</div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-1">
                    <Button size="icon" variant="ghost" title="View" onClick={() => setSelectedId(t.id)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    {t.status !== "active" && (
                      <Button size="sm" variant="outline" onClick={() => setStatus(t.id, "active")}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> {t.status === "pending" ? "Approve" : "Activate"}
                      </Button>
                    )}
                    {t.status === "active" && (
                      <Button size="sm" variant="ghost" onClick={() => suspend(t.id, t.name)}>
                        <Ban className="h-4 w-4 mr-1 text-destructive" /> Suspend
                      </Button>
                    )}
                    {t.status !== "archived" && (
                      <Button size="icon" variant="ghost" title="Archive" onClick={() => {
                        if (confirm(`Archive "${t.name}"? Owner loses access.`)) setStatus(t.id, "archived");
                      }}>
                        <Archive className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <TenantDetailDialog tenantId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

type TenantDetail = {
  tenant: any;
  members: Array<{ user_id: string; role: string; joined_at: string; full_name: string | null; email: string | null }>;
  subscription: any;
  stats: {
    products: number; customers: number; suppliers: number;
    sales_count: number; sales_total: number; last_sale_at: string | null;
  };
};

function TenantDetailDialog({ tenantId, onClose }: { tenantId: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-tenant-detail", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_tenant_detail", { _tenant_id: tenantId });
      if (error) throw error;
      return data as unknown as TenantDetail;
    },
  });
  return (
    <Dialog open={!!tenantId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{data?.tenant?.name ?? "Shop details"}</DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <TableSkeleton rows={4} columns={3} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard title="Products" value={data.stats.products} icon={Package} />
              <StatCard title="Customers" value={data.stats.customers} icon={Users} />
              <StatCard title="Sales" value={data.stats.sales_count} icon={ShoppingCart} />
              <StatCard title="Revenue" value={fmtMoney(data.stats.sales_total, "")} />
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Team</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.members ?? []).map((m) => (
                    <TableRow key={m.user_id}>
                      <TableCell>{m.full_name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{m.email ?? "—"}</TableCell>
                      <TableCell>{m.role}</TableCell>
                      <TableCell>{m.joined_at ? new Date(m.joined_at).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {data.subscription && (
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium mb-1">Subscription</div>
                <div className="text-muted-foreground">
                  Status: {data.subscription.status ?? "—"} · Started:{" "}
                  {data.subscription.started_at ? new Date(data.subscription.started_at).toLocaleDateString() : "—"} ·
                  Expires:{" "}
                  {data.subscription.expires_at ? new Date(data.subscription.expires_at).toLocaleDateString() : "—"}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ErrorsTab() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-errors"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_recent_errors", { _limit: 100 });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });
  return (
    <Card className="p-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Where</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow><TableCell colSpan={5} className="py-4"><TableSkeleton rows={5} columns={5} /></TableCell></TableRow>
          )}
          {!isLoading && rows.length === 0 && (
            <TableRow><TableCell colSpan={5} className="py-8">
              <EmptyState icon={Bug} title="No errors" description="No recent errors logged." />
            </TableCell></TableRow>
          )}
          {rows.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{e.tenant_id?.slice(0, 8) ?? "—"}</TableCell>
              <TableCell><StatusBadge tone="danger">{e.error_type}</StatusBadge></TableCell>
              <TableCell className="max-w-md truncate" title={e.error_message}>{e.error_message}</TableCell>
              <TableCell className="text-muted-foreground">{e.page_or_module ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
