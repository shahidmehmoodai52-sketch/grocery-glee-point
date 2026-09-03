import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, Store, Package, Users, ShoppingCart, TrendingUp, Wallet, AlertTriangle,
  KeyRound, CreditCard, CheckCircle2, Ban, Archive, ShieldCheck, Activity, ScrollText, Trophy, Library, Trash2,
  Calendar, Search, Filter, Eye, Download,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
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
import { TypedConfirmDialog } from "@/components/ui/typed-confirm-dialog";

export const Route = createFileRoute("/admin_/shops/$id")({
  // This route uses the `admin_` escape-hatch naming, so it does NOT inherit
  // /admin's own beforeLoad guard. Match that same server-side check here for
  // consistency (am_i_admin_staff, not the page's own super-admin-only
  // content gate below) so an unauthenticated or non-admin request never even
  // renders a loading flash before the client-side redirect kicks in.
  beforeLoad: async ({ location }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw redirect({ to: "/admin-login", search: { next: location.pathname } });
    }
    const { data: isAdmin } = await supabase.rpc("am_i_admin_staff");
    if (!isAdmin) {
      await supabase.auth.signOut();
      throw redirect({ to: "/admin-login" });
    }
  },
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
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

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
    qc.invalidateQueries({ queryKey: ["admin-tenants-page"] });
  };

  const suspend = async (reason: string) => {
    await setStatus("suspended", reason);
  };

  const removeShop = async (reason: string) => {
    if (!data) return;
    const expected = data.tenant.name.trim();
    let done = false;
    while (!done) {
      const { data: deletionResult, error } = await supabase.rpc("admin_delete_tenant", {
        _tenant_id: tenantId,
        _confirm: expected,
        _reason: reason,
      });
      if (error) { toast.error(error.message); return; }
      done = Boolean(
        deletionResult
        && typeof deletionResult === "object"
        && "done" in deletionResult
        && deletionResult.done,
      );
    }
    toast.success(`Deleted "${expected}"`);
    qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    qc.invalidateQueries({ queryKey: ["admin-tenants-page"] });
    navigate({ to: "/admin", replace: true });
  };

  const enterSupportView = async (reason: string) => {
    const { data: session, error } = await supabase.rpc("admin_start_support_session", {
      _tenant_id: tenantId,
      _reason: reason,
    });
    if (error) { toast.error(error.message); return; }
    const s = session as unknown as { id: string };
    navigate({ to: "/admin/support/$sessionId", params: { sessionId: s.id } });
  };

  if (isLoading || !data) return <div className="p-6"><TableSkeleton rows={6} columns={4} /></div>;
  const t = data.tenant;
  const owner = data.members.find((m) => m.user_id === t.owner_id) ?? null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Panel</Link>
        </Button>
        <div className="flex items-center gap-2">
           <StatusIndicator status={t.status} />
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b pb-6">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Store className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t.name}</h1>
            <p className="text-muted-foreground mt-1 flex items-center gap-2">
              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{t.slug ?? "no-slug"}</span>
              <span>•</span>
              <span>{owner?.email ?? "No owner email"}</span>
              <span>•</span>
              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {new Date(t.created_at).toLocaleDateString()}</span>
            </p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setSupportOpen(true)}>
            <Eye className="h-4 w-4 mr-1" /> View Shop (Support)
          </Button>
          <Button variant="outline" onClick={() => setExportOpen(true)}>
            <Download className="h-4 w-4 mr-1" /> Export Data
          </Button>
          {t.status !== "active" && (
            <Button onClick={() => setStatus("active")}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> {t.status === "pending" ? "Approve" : "Activate"}
            </Button>
          )}
          {t.status === "active" && (
            <Button variant="outline" onClick={() => setSuspendOpen(true)}>
              <Ban className="h-4 w-4 mr-1 text-destructive" /> Suspend
            </Button>
          )}
          <Button
            variant={t.library_approved ? "outline" : "secondary"}
            onClick={async () => {
              const next = !t.library_approved;
              const { error } = await supabase
                .from("tenants")
                .update({ library_approved: next })
                .eq("id", t.id);
              if (error) return toast.error(error.message);
              toast.success(next ? "Library access granted" : "Library access revoked");
              qc.invalidateQueries({ queryKey: ["admin-tenant-detail", tenantId] });
            }}
          >
            <Library className="h-4 w-4 mr-1" />
            {t.library_approved ? "Revoke Library" : "Grant Library"}
          </Button>
          <Button variant="destructive" size="icon" onClick={() => setDeleteOpen(true)} title="Delete shop">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <TypedConfirmDialog
        open={supportOpen}
        onOpenChange={setSupportOpen}
        title="Enter Support View"
        description={`Open a read-only Support View of "${t.name}"? You will NOT become this shop's user and cannot make any changes. A reason is required and this session is logged, time-limited (30 minutes), and auto-expires.`}
        requireReason
        confirmLabel="Enter Support View"
        onConfirm={enterSupportView}
      />

      <TypedConfirmDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        title="Suspend shop"
        description={`Suspend "${t.name}"? The shop's staff will be locked out until it's reactivated.`}
        requireReason
        destructive
        confirmLabel="Suspend"
        onConfirm={suspend}
      />

      <TypedConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete shop permanently"
        description={`PERMANENTLY delete "${t.name}" and ALL its data (products, sales, customers, expenses, staff)? This cannot be undone.`}
        confirmText={t.name}
        requireReason
        destructive
        confirmLabel="Delete permanently"
        onConfirm={removeShop}
      />

      <ExportDataDialog open={exportOpen} onOpenChange={setExportOpen} tenantId={tenantId} tenantName={t.name} />

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

const EXPORT_CATEGORIES = [
  { key: "customers", label: "Customers" },
  { key: "suppliers", label: "Suppliers" },
  { key: "products", label: "Products" },
  { key: "sales", label: "Sales" },
  { key: "purchases", label: "Purchases" },
  { key: "expenses", label: "Expenses" },
] as const;

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => `"${String(row[c] ?? "").replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n");
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportDataDialog({
  open, onOpenChange, tenantId, tenantName,
}: { open: boolean; onOpenChange: (v: boolean) => void; tenantId: string; tenantName: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState("");

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const runExport = async () => {
    const categories = Array.from(selected);
    if (categories.length === 0) return toast.error("Select at least one category");
    setExporting(true);
    try {
      for (const category of categories) {
        setProgress(`Fetching ${category}...`);
        const rows: Record<string, unknown>[] = [];
        let offset = 0;
        let hasMore = true;
        let pages = 0;
        while (hasMore && pages < 50) {
          const { data, error } = await supabase.rpc("admin_export_tenant_data", {
            _tenant_id: tenantId, _category: category, _limit: 1000, _offset: offset,
          });
          if (error) throw error;
          const page = data as unknown as { rows: Record<string, unknown>[]; has_more: boolean };
          rows.push(...page.rows);
          hasMore = page.has_more;
          offset += 1000;
          pages += 1;
          setProgress(`Fetching ${category}... ${rows.length} rows`);
        }
        const safeName = tenantName.replace(/[^a-z0-9]+/gi, "_");
        if (format === "csv") {
          downloadFile(toCsv(rows), `${safeName}-${category}.csv`, "text/csv");
        } else {
          downloadFile(JSON.stringify(rows, null, 2), `${safeName}-${category}.json`, "application/json");
        }
      }
      const { error: logError } = await supabase.rpc("admin_log_tenant_export", {
        _tenant_id: tenantId, _categories: categories,
      });
      if (logError) toast.error(`Export downloaded but audit log failed: ${logError.message}`);
      else toast.success(`Exported ${categories.length} categor${categories.length === 1 ? "y" : "ies"}`);
      onOpenChange(false);
      setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
      setProgress("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !exporting && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Export "{tenantName}" data</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Only this shop's own data is exported. No passwords, tokens, or credentials are included. This export is recorded in the admin audit trail.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {EXPORT_CATEGORIES.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm rounded border p-2 cursor-pointer">
                <Checkbox checked={selected.has(c.key)} onCheckedChange={() => toggle(c.key)} />
                {c.label}
              </label>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label>Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as "csv" | "json")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV (one file per category)</SelectItem>
                <SelectItem value="json">JSON (one file per category)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {exporting && <p className="text-xs text-muted-foreground">{progress}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={exporting}>Cancel</Button>
          <Button onClick={runExport} disabled={exporting || selected.size === 0}>
            <Download className="h-4 w-4 mr-1" /> {exporting ? "Exporting..." : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      const [ss, tm] = await Promise.all([
        supabase.from("store_settings").select("store_name, phone, address").eq("tenant_id", t.id).maybeSingle(),
        supabase.from("tenants").select("metadata").eq("id", t.id).maybeSingle(),
      ]);
      const meta = (tm.data?.metadata ?? {}) as { phone?: string; address?: string; city?: string };
      const metaAddr = [meta.address, meta.city].filter(Boolean).join(", ") || null;
      return {
        store_name: ss.data?.store_name ?? null,
        phone: ss.data?.phone ?? meta.phone ?? null,
        address: ss.data?.address ?? metaAddr,
      };
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

      <div className="space-y-1.5">
        <div className="text-sm font-medium">Price visibility</div>
        <Select
          value={
            flags?.showSell && flags?.showCost ? "both"
              : flags?.showSell ? "sell"
              : flags?.showCost ? "cost"
              : "none"
          }
          onValueChange={async (v) => {
            const showSell = v === "sell" || v === "both";
            const showCost = v === "cost" || v === "both";
            const { data, error } = await supabase.from("tenants").update({
              library_show_sell_price: showSell,
              library_show_cost_price: showCost,
            }).eq("id", tenantId).select("library_show_sell_price, library_show_cost_price").maybeSingle();
            if (error) return toast.error(error.message);
            if (!data) return toast.error("Price visibility was not saved");
            toast.success("Price visibility updated");
            qc.invalidateQueries({ queryKey: ["tenant-library-flags", tenantId] });
          }}
        >
          <SelectTrigger><SelectValue placeholder="Choose visibility" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sell">Show sale rate only</SelectItem>
            <SelectItem value="cost">Show purchase rate only</SelectItem>
            <SelectItem value="both">Show both</SelectItem>
            <SelectItem value="none">Hide both</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground">Controls what prices this shop sees from the global library.</div>
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
  const [drilldownOpen, setDrilldownOpen] = useState(false);
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
        <StatCard label="Revenue (30d)" value={fmtMoney(totalRevenue, "")} icon={TrendingUp} tone="primary" />
        <StatCard label="Orders (30d)" value={totalOrders} icon={ShoppingCart} />
        <StatCard label="Est. profit" value={fmtMoney(totalRevenue - totalCost, "")} icon={Wallet} tone="success" />
        <StatCard label="Expenses (30d)" value={fmtMoney(data.expenses_total || 0, "")} icon={ArrowLeft} tone="danger" />
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
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.by_method.map((m) => {
                  const isCredit = m.method.toLowerCase() === "credit";
                  return (
                    <TableRow
                      key={m.method}
                      className={isCredit ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
                      onClick={() => isCredit && setDrilldownOpen(true)}
                    >
                      <TableCell className="capitalize flex items-center gap-2">
                        {m.method}
                        {isCredit && <Activity className="h-3 w-3 text-primary animate-pulse" />}
                      </TableCell>
                      <TableCell className="text-right">{Number(m.orders)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {fmtMoney(Number(m.total), "")}
                        {isCredit && <ChevronDown className="h-3 w-3 inline ml-1 opacity-50" />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div className="mt-3 text-xs text-muted-foreground">Expenses (30d): {fmtMoney(data.expenses_total, "")}</div>
        </Card>
      </div>

      <CreditSalesDrilldown
        tenantId={tenantId}
        open={drilldownOpen}
        onOpenChange={setDrilldownOpen}
      />
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

function TenantSecurityCard({ tenantId }: { tenantId: string }) {
  // security_events' RLS policy only allows super_admin, not admin staff
  // granted the delegable 'shops.view' permission — going through
  // admin_tenant_security_events (gated on 'shops.view', tenant-scoped
  // server-side so this can never surface another tenant's events) instead
  // of reading the table directly keeps this card working for both.
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["admin-tenant-security-events", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_tenant_security_events", {
        _tenant_id: tenantId,
        _limit: 20,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card className="p-3">
      <div className="text-sm font-medium mb-2 flex items-center gap-1"><ShieldCheck className="h-4 w-4" /> Security events (last 20)</div>
      {isLoading ? (
        <TableSkeleton rows={3} columns={3} />
      ) : events.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Clean" description="No security events recorded for this shop." />
      ) : (
        <div className="space-y-1.5">
          {events.map((e) => (
            <div key={e.id} className="text-xs p-2 rounded border flex items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="font-medium">{e.event_type}</span>
                <span className="text-muted-foreground truncate">{e.ip_address || e.email || "—"}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge tone={e.severity === "critical" ? "danger" : e.severity === "warning" ? "warning" : "neutral"}>{e.severity}</StatusBadge>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
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
    <div className="space-y-3">
    <TenantSecurityCard tenantId={tenantId} />
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
              <TableHead>Target Table</TableHead>
              <TableHead>Changes / Record</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</TableCell>
                <TableCell><StatusBadge tone={a.action === "DELETE" ? "danger" : a.action === "INSERT" ? "success" : "neutral"}>{a.action}</StatusBadge></TableCell>
                <TableCell className="text-[10px] font-mono">{a.table_name}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground">
                  <div className="font-mono mb-1">{a.record_id?.slice(0, 8) ?? "—"}</div>
                  {a.changed_fields && (
                    <div className="max-w-xs overflow-hidden text-[9px] border rounded p-1 bg-muted/20">
                      {Object.entries(a.changed_fields).map(([k, v]) => (
                        <div key={k} className="truncate">
                          <span className="font-semibold text-primary/70">{k}:</span> {JSON.stringify(v)}
                        </div>
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
    </div>
  );
}

function CreditSalesDrilldown({
  tenantId,
  open,
  onOpenChange,
}: {
  tenantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-credit-sales", tenantId, page],
    enabled: open,
    queryFn: async () => {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await supabase
        .from("sales")
        .select("id, invoice_no, total, created_at, customer:customers(name)", { count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("payment_method", "credit")
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      return { items: data || [], total: count || 0 };
    },
  });

  const totalPages = Math.ceil((data?.total || 0) / pageSize);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <CreditCard className="h-5 w-5 text-primary" />
            Credit Sales
          </DialogTitle>
          <div className="text-sm text-muted-foreground mt-1">
            All invoices recorded with the credit payment method for this shop.
          </div>

        </DialogHeader>

        <div className="flex-1 overflow-auto px-6 py-2">
          {isLoading ? (
            <TableSkeleton rows={10} columns={4} />
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="No credit sales found"
              description="This shop doesn't have any sales recorded with the 'credit' payment method."
            />
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="w-[150px]">Date</TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((sale) => (
                      <TableRow key={sale.id} className="hover:bg-muted/20">
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(sale.created_at).toLocaleDateString()}
                          <span className="block text-[10px] opacity-70">
                            {new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium">{sale.invoice_no}</TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {(sale.customer as any)?.name || "Walk-in Customer"}
                        </TableCell>
                        <TableCell className="text-right font-bold text-primary">
                          {fmtMoney(Number(sale.total), "")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2 border-t border-border/40">
                <div className="text-xs text-muted-foreground font-medium">
                  Showing <span className="text-foreground">{page * pageSize + 1}</span> to{" "}
                  <span className="text-foreground">{Math.min((page + 1) * pageSize, data.total)}</span> of{" "}
                  <span className="text-foreground">{data.total}</span> entries
                  <span className="block mt-1">
                    Page total:{" "}
                    <span className="text-foreground font-semibold">
                      {fmtMoney(data.items.reduce((s, r) => s + Number(r.total || 0), 0), "")}
                    </span>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-semibold"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <div className="text-xs font-bold px-3 py-1 bg-muted rounded-md border border-border/40">
                    Page {page + 1} of {totalPages || 1}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-semibold"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= totalPages - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="p-6 pt-2 border-t border-border/40">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="font-semibold">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
