import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, Store, Package, Users, ShoppingCart, TrendingUp, Wallet, AlertTriangle,
  KeyRound, CreditCard, CheckCircle2, Ban, Archive, ShieldCheck, Activity, ScrollText, Trophy, Library, Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard } from "@/components/ui/stat-card";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSuperAdmin } from "@/hooks/use-super-admin";
import { fmtMoney } from "@/lib/format";
import { resetTenantOwnerPassword } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin_/shops/$id")({
  component: ShopDetailPage,
});

function ShopDetailPage() {
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const { isSuperAdmin, loading } = useSuperAdmin();

  useEffect(() => {
    if (!loading && !isSuperAdmin) navigate({ to: "/dashboard", replace: true });
  }, [loading, isSuperAdmin, navigate]);

  if (loading) return <div className="p-6"><TableSkeleton rows={6} columns={4} /></div>;
  if (!isSuperAdmin) return null;

  return <ShopDetail tenantId={id} />;
}

type TenantDetail = {
  tenant: {
    id: string; name: string; slug: string | null; status: string; plan: string | null;
    owner_id: string | null; created_at: string; library_approved?: boolean;
  };
  members: Array<{ user_id: string; role: string; joined_at: string; full_name: string | null; email: string | null }>;
  subscription: {
    id: string; plan_id: string; status: string; started_at: string; expires_at: string | null;
  } | null;
  stats: {
    products: number; customers: number; suppliers: number;
    sales_count: number; sales_total: number; last_sale_at: string | null;
  };
};

function ShopDetail({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tenant-detail", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_tenant_detail", { _tenant_id: tenantId });
      if (error) throw error;
      return data as unknown as TenantDetail;
    },
  });

  const setStatus = async (status: string, reason?: string) => {
    const { error } = await supabase.rpc("admin_set_tenant_status", {
      _tenant_id: tenantId, _status: status, _reason: reason ?? undefined,
    });
    if (error) return toast.error(error.message);
    toast.success(`Shop ${status}`);
    qc.invalidateQueries({ queryKey: ["admin-tenant-detail", tenantId] });
    qc.invalidateQueries({ queryKey: ["admin-tenants"] });
  };

  const suspend = async () => {
    const reason = window.prompt(`Suspend "${data?.tenant.name}"? Reason:`) ?? "";
    if (!reason) return;
    await setStatus("suspended", reason);
  };

  const removeShop = async () => {
    if (!data) return;
    const expected = data.tenant.name.trim();
    const typed = window.prompt(
      `PERMANENTLY delete this shop and ALL its data (products, sales, customers, expenses, staff)?\n\nThis cannot be undone.\n\nType exactly:  ${expected}`,
    );
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== expected.toLowerCase()) {
      return toast.error(`Confirmation did not match. Expected: "${expected}"`);
    }
    const { error } = await supabase.rpc("admin_delete_tenant", { _tenant_id: tenantId, _confirm: expected });
    if (error) return toast.error(error.message);
    toast.success(`Deleted "${expected}"`);
    qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    navigate({ to: "/admin", replace: true });
  };

  if (isLoading || !data) return <div className="p-6"><TableSkeleton rows={6} columns={4} /></div>;
  const t = data.tenant;
  const owner = data.members.find((m) => m.user_id === t.owner_id) ?? null;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin"><ArrowLeft className="h-4 w-4 mr-1" /> Admin panel</Link>
        </Button>
      </div>
      <PageHeader
        title={t.name}
        description={`${owner?.email ?? "No owner"} · ${t.slug ?? "—"} · Registered ${new Date(t.created_at).toLocaleDateString()}`}
        icon={<Store className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <StatusIndicator status={t.status} />
            {t.status !== "active" && (
              <Button size="sm" onClick={() => setStatus("active")}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> {t.status === "pending" ? "Approve" : "Activate"}
              </Button>
            )}
            {t.status === "active" && (
              <Button size="sm" variant="outline" onClick={suspend}>
                <Ban className="h-4 w-4 mr-1 text-destructive" /> Suspend
              </Button>
            )}
            <Button
              size="sm"
              variant={t.library_approved ? "outline" : "default"}
              onClick={async () => {
                const next = !t.library_approved;
                const { error } = await supabase
                  .from("tenants")
                  .update({ library_approved: next })
                  .eq("id", t.id);
                if (error) return toast.error(error.message);
                toast.success(next ? "Global library access granted" : "Global library access revoked");
                qc.invalidateQueries({ queryKey: ["admin-tenant-detail", tenantId] });
              }}
            >
              <Library className="h-4 w-4 mr-1" />
              {t.library_approved ? "Revoke library access" : "Grant library access"}
            </Button>
            {t.status !== "archived" && (
              <Button size="sm" variant="ghost" onClick={() => {
                if (confirm(`Archive "${t.name}"? Owner loses access.`)) setStatus("archived");
              }}>
                <Archive className="h-4 w-4 mr-1" /> Archive
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={removeShop}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete shop
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview"><ShieldCheck className="h-4 w-4 mr-1" />Overview</TabsTrigger>
          <TabsTrigger value="sales"><TrendingUp className="h-4 w-4 mr-1" />Sales &amp; Revenue</TabsTrigger>
          <TabsTrigger value="staff"><Users className="h-4 w-4 mr-1" />Staff</TabsTrigger>
          <TabsTrigger value="plan"><CreditCard className="h-4 w-4 mr-1" />Plan</TabsTrigger>
          <TabsTrigger value="activity"><Activity className="h-4 w-4 mr-1" />Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-3">
          <OverviewTab detail={data} />
        </TabsContent>
        <TabsContent value="sales" className="mt-3">
          <SalesTab tenantId={tenantId} />
        </TabsContent>
        <TabsContent value="staff" className="mt-3">
          <StaffTab detail={data} tenantId={tenantId} />
        </TabsContent>
        <TabsContent value="plan" className="mt-3">
          <PlanTab detail={data} tenantId={tenantId} />
        </TabsContent>
        <TabsContent value="activity" className="mt-3">
          <ActivityTab tenantId={tenantId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusIndicator({ status }: { status: string }) {
  if (status === "active") return <StatusBadge tone="success">Active</StatusBadge>;
  if (status === "pending") return <StatusBadge tone="warning">Pending approval</StatusBadge>;
  if (status === "suspended") return <StatusBadge tone="danger">Suspended</StatusBadge>;
  return <StatusBadge tone="neutral">{status}</StatusBadge>;
}

function OverviewTab({ detail }: { detail: TenantDetail }) {
  const s = detail.stats;
  const t = detail.tenant;
  const owner = detail.members.find((m) => m.user_id === t.owner_id) ?? null;

  const { data: settings } = useQuery({
    queryKey: ["admin-shop-settings", t.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_settings")
        .select("store_name, phone, address")
        .eq("tenant_id", t.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Products" value={s.products} icon={Package} />
        <StatCard label="Customers" value={s.customers} icon={Users} />
        <StatCard label="Sales" value={s.sales_count} icon={ShoppingCart} />
        <StatCard label="Revenue" value={fmtMoney(s.sales_total, "")} icon={Wallet} />
      </div>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-medium">Shop details</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Detail label="Shop name" value={settings?.store_name || t.name} />
          <Detail label="Shop code" value={t.slug ?? "—"} mono />
          <Detail label="Owner name" value={owner?.full_name ?? "—"} />
          <Detail label="Owner email" value={owner?.email ?? "—"} />
          <Detail label="Phone" value={settings?.phone ?? "—"} />
          <Detail label="City / Address" value={settings?.address ?? "—"} />
          <Detail label="Status" value={t.status} />
          <Detail label="Plan" value={t.plan ?? "—"} />
          <Detail label="Registered" value={new Date(t.created_at).toLocaleString()} />
          <Detail label="Last sale" value={s.last_sale_at ? new Date(s.last_sale_at).toLocaleString() : "—"} />
          <Detail label="Suppliers" value={String(s.suppliers)} />
        </div>
      </Card>

      <LibraryCategoryAccessCard tenantId={t.id} libraryApproved={!!t.library_approved} />
    </div>
  );
}

function LibraryCategoryAccessCard({ tenantId, libraryApproved }: { tenantId: string; libraryApproved: boolean }) {
  const qc = useQueryClient();
  const { data: cats = [], isLoading: catsLoading } = useQuery({
    queryKey: ["library-categories-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("global_products")
        .select("category")
        .eq("status", "approved")
        .not("category", "is", null);
      if (error) throw error;
      const set = new Set<string>();
      for (const r of data ?? []) if (r.category) set.add(r.category);
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    },
  });
  const { data: allowed = [], isLoading: allowedLoading } = useQuery({
    queryKey: ["tenant-library-categories", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_library_categories")
        .select("category")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return (data ?? []).map((r) => r.category);
    },
  });

  const allowedSet = useMemo(() => new Set(allowed), [allowed]);
  const restricted = allowed.length > 0;

  const toggle = async (cat: string, on: boolean) => {
    if (on) {
      const { error } = await supabase
        .from("tenant_library_categories")
        .insert({ tenant_id: tenantId, category: cat });
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase
        .from("tenant_library_categories")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("category", cat);
      if (error) return toast.error(error.message);
    }
    qc.invalidateQueries({ queryKey: ["tenant-library-categories", tenantId] });
  };

  const grantAll = async () => {
    const { error } = await supabase
      .from("tenant_library_categories")
      .delete()
      .eq("tenant_id", tenantId);
    if (error) return toast.error(error.message);
    toast.success("Shop can now see every library category");
    qc.invalidateQueries({ queryKey: ["tenant-library-categories", tenantId] });
  };

  const blockAll = async () => {
    const rows = cats.map((c) => ({ tenant_id: tenantId, category: c }));
    if (rows.length === 0) return;
    // First clear, then insert none-of-them-but-fake? Instead: insert a sentinel row that matches nothing.
    // Simpler: leave restricted with zero rows means "all allowed" — so to block-all we insert a non-existent sentinel.
    const { error: e1 } = await supabase
      .from("tenant_library_categories")
      .delete()
      .eq("tenant_id", tenantId);
    if (e1) return toast.error(e1.message);
    const { error: e2 } = await supabase
      .from("tenant_library_categories")
      .insert({ tenant_id: tenantId, category: "__none__" });
    if (e2) return toast.error(e2.message);
    toast.success("Shop can no longer see any library items");
    qc.invalidateQueries({ queryKey: ["tenant-library-categories", tenantId] });
  };

  if (!libraryApproved) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        <div className="font-medium text-foreground mb-1">Library category access</div>
        Grant library access first (button in the header) to choose which categories this shop can see.
      </Card>
    );
  }

  const { data: flags } = useQuery({
    queryKey: ["tenant-library-flags", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("library_show_sell_price, library_show_cost_price")
        .eq("id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return {
        showSell: data?.library_show_sell_price ?? true,
        showCost: data?.library_show_cost_price ?? true,
      };
    },
  });

  const setFlag = async (col: "library_show_sell_price" | "library_show_cost_price", val: boolean) => {
    const { error } = await supabase.from("tenants").update({ [col]: val }).eq("id", tenantId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["tenant-library-flags", tenantId] });
  };

  const summary = restricted
    ? `${allowed.length} categor${allowed.length === 1 ? "y" : "ies"} selected`
    : "All categories";

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-medium">Library access</div>
          <div className="text-xs text-muted-foreground">
            Choose what this shop sees from the global library.
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <div className="text-sm font-medium">Show sale rate</div>
            <div className="text-xs text-muted-foreground">Library's default sale price visible to this shop.</div>
          </div>
          <Switch
            checked={flags?.showSell ?? true}
            onCheckedChange={(v) => setFlag("library_show_sell_price", v)}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <div className="text-sm font-medium">Show purchase rate</div>
            <div className="text-xs text-muted-foreground">Library's default purchase price visible to this shop.</div>
          </div>
          <Switch
            checked={flags?.showCost ?? true}
            onCheckedChange={(v) => setFlag("library_show_cost_price", v)}
          />
        </label>
      </div>

      <div className="space-y-1.5">
        <div className="text-sm font-medium">Categories</div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full justify-between" disabled={catsLoading || allowedLoading}>
              <span className="truncate">{catsLoading || allowedLoading ? "Loading…" : summary}</span>
              <ChevronDown className="h-4 w-4 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="text-xs text-muted-foreground">
                {restricted ? "Only ticked categories are visible" : "All categories are visible"}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={grantAll}>Allow all</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={blockAll}>Block all</Button>
              </div>
            </div>
            {cats.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">No categories in the library yet.</div>
            ) : (
              <div className="max-h-72 overflow-auto p-1">
                {cats.map((c) => {
                  const on = !restricted || allowedSet.has(c);
                  return (
                    <label
                      key={c}
                      className="flex items-center gap-2 text-sm cursor-pointer rounded px-2 py-1.5 hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => {
                          if (!restricted && !e.target.checked) {
                            (async () => {
                              const rows = cats
                                .filter((x) => x !== c)
                                .map((x) => ({ tenant_id: tenantId, category: x }));
                              if (rows.length > 0) {
                                const { error } = await supabase.from("tenant_library_categories").insert(rows);
                                if (error) return toast.error(error.message);
                              }
                              qc.invalidateQueries({ queryKey: ["tenant-library-categories", tenantId] });
                            })();
                            return;
                          }
                          toggle(c, e.target.checked);
                        }}
                      />
                      <span className="truncate">{c}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </Card>
  );
}


function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/50 pb-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono" : "font-medium"}>{value}</span>
    </div>
  );
}

type Analytics = {
  range: { from: string; to: string };
  daily: Array<{ day: string; orders: number; revenue: number; cost: number }>;
  top_products: Array<{ name: string; qty: number; revenue: number }>;
  by_method: Array<{ method: string; orders: number; total: number }>;
  low_stock: number;
  expenses_total: number;
};

function SalesTab({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-shop-analytics", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_shop_analytics", { _tenant_id: tenantId });
      if (error) throw error;
      return data as unknown as Analytics;
    },
  });

  const maxRev = useMemo(() => Math.max(1, ...(data?.daily ?? []).map((d) => Number(d.revenue))), [data]);
  if (isLoading || !data) return <TableSkeleton rows={5} columns={4} />;

  const totalRevenue = data.daily.reduce((a, d) => a + Number(d.revenue), 0);
  const totalCost = data.daily.reduce((a, d) => a + Number(d.cost), 0);
  const totalOrders = data.daily.reduce((a, d) => a + Number(d.orders), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Revenue (30d)" value={fmtMoney(totalRevenue, "")} icon={TrendingUp} />
        <StatCard label="Orders (30d)" value={totalOrders} icon={ShoppingCart} />
        <StatCard label="Est. profit" value={fmtMoney(totalRevenue - totalCost, "")} icon={Wallet} tone="success" />
        <StatCard label="Low stock" value={data.low_stock} icon={AlertTriangle} tone={data.low_stock > 0 ? "warning" : "default"} />
      </div>

      <Card className="p-4">
        <div className="text-sm font-medium mb-3">Daily revenue — last 30 days</div>
        {data.daily.length === 0 ? (
          <EmptyState icon={TrendingUp} title="No sales in this window" description="This shop has no sales in the last 30 days." />
        ) : (
          <div className="flex items-end gap-1 h-40 overflow-x-auto">
            {data.daily.map((d) => (
              <div key={d.day} className="flex flex-col items-center min-w-[24px]" title={`${d.day}: ${fmtMoney(Number(d.revenue), "")} (${d.orders} orders)`}>
                <div className="w-4 bg-primary rounded-t" style={{ height: `${(Number(d.revenue) / maxRev) * 140}px` }} />
                <div className="text-[9px] text-muted-foreground mt-1">{d.day.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-sm font-medium mb-2 flex items-center gap-1"><Trophy className="h-4 w-4" /> Top products</div>
          {data.top_products.length === 0 ? (
            <div className="text-sm text-muted-foreground">No product sales.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.top_products.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-right">{Number(p.qty)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(Number(p.revenue), "")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="p-4">
          <div className="text-sm font-medium mb-2 flex items-center gap-1"><Wallet className="h-4 w-4" /> Payment method breakdown</div>
          {data.by_method.length === 0 ? (
            <div className="text-sm text-muted-foreground">No payments recorded.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.by_method.map((m) => (
                  <TableRow key={m.method}>
                    <TableCell className="capitalize">{m.method}</TableCell>
                    <TableCell className="text-right">{Number(m.orders)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(Number(m.total), "")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="mt-3 text-xs text-muted-foreground">Expenses (30d): {fmtMoney(data.expenses_total, "")}</div>
        </Card>
      </div>
    </div>
  );
}

function StaffTab({ detail, tenantId }: { detail: TenantDetail; tenantId: string }) {
  const [pwOpen, setPwOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const reset = useServerFn(resetTenantOwnerPassword);
  const mut = useMutation({
    mutationFn: async () => {
      if (!newPassword || newPassword.length < 6) throw new Error("6+ character password chahiye");
      return reset({ data: { tenant_id: tenantId, new_password: newPassword } });
    },
    onSuccess: () => {
      toast.success("Owner ka password reset ho gaya. Naya password owner ko share karein.");
      setPwOpen(false);
      setNewPassword("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setPwOpen(true)} disabled={!detail.tenant.owner_id}>
          <KeyRound className="h-4 w-4 mr-1" /> Reset owner password
        </Button>
      </div>
      <Card className="p-3">
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
            {(detail.members ?? []).map((m) => (
              <TableRow key={m.user_id}>
                <TableCell>
                  {m.full_name ?? "—"}
                  {m.user_id === detail.tenant.owner_id && <StatusBadge tone="warning" className="ml-2">Owner</StatusBadge>}
                </TableCell>
                <TableCell className="text-muted-foreground">{m.email ?? "—"}</TableCell>
                <TableCell>{m.role}</TableCell>
                <TableCell>{m.joined_at ? new Date(m.joined_at).toLocaleDateString() : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset owner password</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Naya password set kar ke owner ko share karein. Purana password kaam nahi karega.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="newpw">New password</Label>
              <Input id="newpw" type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} placeholder="6+ characters" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwOpen(false)}>Cancel</Button>
            <Button onClick={() => mut.mutate()} disabled={mut.isPending}>Reset password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanTab({ detail, tenantId }: { detail: TenantDetail; tenantId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState<string>(detail.subscription?.plan_id ?? "");
  const [expiresAt, setExpiresAt] = useState<string>(
    detail.subscription?.expires_at ? new Date(detail.subscription.expires_at).toISOString().slice(0, 10) : ""
  );
  const [status, setStatus] = useState<string>(detail.subscription?.status ?? "active");

  const { data: plans = [] } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_plans").select("id,name,description,price_monthly,max_users,max_products,active").order("price_monthly");
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!planId) throw new Error("Plan select karein");
      const { error } = await supabase.rpc("admin_set_tenant_plan", {
        _tenant_id: tenantId,
        _plan_id: planId,
        _expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plan updated");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-tenant-detail", tenantId] });
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sub = detail.subscription;
  const currentPlanName = plans.find((p) => p.id === sub?.plan_id)?.name ?? detail.tenant.plan ?? "—";

  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Current plan</div>
            <div className="text-lg font-semibold">{currentPlanName}</div>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}><CreditCard className="h-4 w-4 mr-1" /> Change plan</Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
          <div>
            <div className="text-xs text-muted-foreground">Status</div>
            <div>{sub?.status ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Started</div>
            <div>{sub?.started_at ? new Date(sub.started_at).toLocaleDateString() : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Expires</div>
            <div>{sub?.expires_at ? new Date(sub.expires_at).toLocaleDateString() : "—"}</div>
          </div>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change plan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger><SelectValue placeholder="Select plan" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {fmtMoney(Number(p.price_monthly), "")}/mo
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trialing">Trialing</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="past_due">Past due</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp">Expires at (optional)</Label>
              <Input id="exp" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActivityTab({ tenantId }: { tenantId: string }) {
  const { data: audit = [], isLoading } = useQuery({
    queryKey: ["admin-tenant-audit", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_tenant_audit", { _tenant_id: tenantId, _limit: 100 });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  if (isLoading) return <TableSkeleton rows={6} columns={4} />;

  return (
    <Card className="p-3">
      <div className="text-sm font-medium mb-2 flex items-center gap-1"><ScrollText className="h-4 w-4" /> Recent activity (last 100)</div>
      {audit.length === 0 ? (
        <EmptyState icon={Activity} title="No activity" description="No audit log entries yet." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Table</TableHead>
              <TableHead>Record</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</TableCell>
                <TableCell><StatusBadge tone={a.action === "DELETE" ? "danger" : a.action === "INSERT" ? "success" : "neutral"}>{a.action}</StatusBadge></TableCell>
                <TableCell className="text-xs">{a.table_name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{a.record_id?.slice(0, 8) ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
