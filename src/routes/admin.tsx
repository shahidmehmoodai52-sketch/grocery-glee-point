import { createFileRoute, useNavigate, Link, Outlet, redirect } from "@tanstack/react-router";
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
  ShieldAlert,
  Lock,
  Unlock,
  AlertTriangle,
  Plus,
  Check,
  RotateCcw,
  Trash2,
  CalendarClock,
  Printer,
  LogOut,
  Activity,
  TrendingUp,
  Wallet,
  LayoutDashboard,
  HeartPulse,
  RefreshCw,
  Flag,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { 
  Select, 
  SelectTrigger, 
  SelectValue, 
  SelectContent, 
  SelectItem 
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess, ADMIN_PERMS } from "@/hooks/use-admin-access";
import { getLocalPrinterSettings, saveLocalPrinterSettings } from "@/lib/offline/printer-settings";
import { fmtMoney } from "@/lib/format";
import { NeedsInternetBanner } from "@/components/needs-internet-banner";
import { useServerFn } from "@tanstack/react-start";
import {
  listAdminStaff,
  addAdminStaff,
  setAdminStaffPermissions,
  removeAdminStaff,
} from "@/lib/admin-staff.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { UserCog, BookOpen } from "lucide-react";
import { autoRemediate } from "@/lib/admin-error-remediation";
import { Toaster } from "@/components/ui/sonner";
import { TypedConfirmDialog } from "@/components/ui/typed-confirm-dialog";


export const Route = createFileRoute("/admin")({
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
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/admin-login", replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-14 border-b bg-card px-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h1 className="font-semibold text-lg">Tillix Admin</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-2 text-muted-foreground hover:text-foreground">
          <LogOut className="h-4 w-4" />
          <span>Sign out</span>
        </Button>
      </header>
      <main className="flex-1">
        <AdminPanelPage />
      </main>
      <Toaster richColors position="top-right" duration={4000} closeButton />
    </div>
  );
}

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
  last_activity_at: string | null;
  last_login_at: string | null;
  plan_max_users: number | null;
  plan_max_products: number | null;
};

type SecuritySummary = {
  failed_logins_24h: number;
  critical_24h: number;
  total_24h: number;
  active_blocks: number;
  unique_ips_24h: number;
};

type AdminActionLog = {
  id: string;
  created_at: string;
  actor_id: string | null;
  action: string;
  tenant_id: string | null;
  tenant_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  reason: string | null;
  metadata: any;
};



function AdminPanelPage() {
  const navigate = useNavigate();
  const { isSuperAdmin, isAdminStaff, canEnter, loading } = useAdminAccess();
  const [activeTab, setActiveTab] = useState("dashboard");

  useEffect(() => {
    if (!loading && !canEnter) {
      navigate({ to: "/admin-login", replace: true });
    }
  }, [loading, canEnter, navigate]);

  const { data: errorCount = 0 } = useQuery({
    queryKey: ["admin-errors-count"],
    enabled: canEnter,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_recent_errors", { _limit: 100 });
      if (error) throw error;
      return ((data as any[]) ?? []).length;
    },
  });

  const { data: securitySummary } = useQuery({
    queryKey: ["admin-security-summary"],
    enabled: canEnter,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_security_summary");
      if (error) throw error;
      return (data as unknown as SecuritySummary) ?? null;
    },
  });

  const securityAlert =
    (securitySummary?.critical_24h ?? 0) > 0 ||
    (securitySummary?.active_blocks ?? 0) > 0 ||
    (securitySummary?.failed_logins_24h ?? 0) >= 5;

  if (loading) {
    return <div className="p-6"><TableSkeleton rows={6} columns={5} /></div>;
  }
  if (!canEnter) return null;

  const alertTabClass =
    "data-[state=inactive]:bg-destructive/15 data-[state=inactive]:text-destructive data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground";
  const okTabClass =
    "data-[state=inactive]:bg-emerald-500/10 data-[state=inactive]:text-emerald-600 dark:data-[state=inactive]:text-emerald-400";

  return (
    <div className="p-6 space-y-4">
      <NeedsInternetBanner section="Admin panel" />
      <PageHeader
        title="Control Panel"
        description="Managed by tillix.co support · info@tillix.co"
        icon={<ShieldCheck className="h-5 w-5" />}
      />
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted/50 p-1 flex-wrap h-auto justify-start">
           <TabsTrigger value="dashboard"><LayoutDashboard className="h-4 w-4 mr-1" />Dashboard</TabsTrigger>
          <TabsTrigger value="tenants"><Store className="h-4 w-4 mr-1" />Tenants</TabsTrigger>
          <TabsTrigger value="library"><BookOpen className="h-4 w-4 mr-1" />Library</TabsTrigger>
          <TabsTrigger value="printers"><Printer className="h-4 w-4 mr-1" />Printers</TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="staff"><UserCog className="h-4 w-4 mr-1" />Admin staff</TabsTrigger>
          )}
          <TabsTrigger value="security" className={securityAlert ? alertTabClass : okTabClass}>
            <ShieldAlert className="h-4 w-4 mr-1" />
            Security
            {securityAlert ? (
              <span className="ml-2 inline-flex items-center rounded-full bg-destructive-foreground/20 px-1.5 text-[10px] font-semibold">!</span>
            ) : (
              <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="errors" className={errorCount > 0 ? alertTabClass : okTabClass}>
            <Bug className="h-4 w-4 mr-1" />
            Errors
            {errorCount > 0 ? (
              <span className="ml-2 inline-flex items-center rounded-full bg-destructive-foreground/20 px-1.5 text-[10px] font-semibold">{errorCount}</span>
            ) : (
              <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="health"><HeartPulse className="h-4 w-4 mr-1" />Health</TabsTrigger>
          <TabsTrigger value="billing"><Wallet className="h-4 w-4 mr-1" />Billing</TabsTrigger>
          <TabsTrigger value="flags"><Flag className="h-4 w-4 mr-1" />Feature Flags</TabsTrigger>
        </TabsList>
         <TabsContent value="dashboard" className="mt-3"><DashboardTab setActiveTab={setActiveTab} /></TabsContent>
        <TabsContent value="tenants" className="mt-3"><TenantsTab /></TabsContent>
        <TabsContent value="library" className="mt-3"><LibraryTab /></TabsContent>
        <TabsContent value="printers" className="mt-3"><PrinterSettingsTab /></TabsContent>
        {isSuperAdmin && (
          <TabsContent value="staff" className="mt-3"><AdminStaffTab /></TabsContent>
        )}
        <TabsContent value="security" className="mt-3"><SecurityTab /></TabsContent>
        <TabsContent value="errors" className="mt-3"><ErrorsTab /></TabsContent>
        <TabsContent value="health" className="mt-3"><HealthTab /></TabsContent>
        <TabsContent value="billing" className="mt-3"><BillingTab /></TabsContent>
        <TabsContent value="flags" className="mt-3"><FeatureFlagsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

interface HealthCheck {
  name: string;
  status: "healthy" | "warning" | "critical";
  detail: string;
  checked_at: string;
}
interface PlatformHealth {
  overall: "healthy" | "warning" | "critical";
  checks: HealthCheck[];
  generated_at: string;
}

const healthTone: Record<string, "success" | "warning" | "danger"> = {
  healthy: "success",
  warning: "warning",
  critical: "danger",
};

function HealthTab() {
  const queryClient = useQueryClient();
  const { data: health, isFetching, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["admin-platform-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_platform_health");
      if (error) throw error;
      return data as unknown as PlatformHealth;
    },
  });

  if (isLoading) return <TableSkeleton rows={5} columns={2} />;
  if (!health) return <EmptyState icon={HeartPulse} title="Health unavailable" description="Could not load platform health." />;

  const overallTone = healthTone[health.overall] ?? "neutral";

  return (
    <div className="space-y-4">
      <Card className="p-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className={`grid h-10 w-10 place-items-center rounded-full ${
            overallTone === "success" ? "bg-success/10 text-success" :
            overallTone === "warning" ? "bg-warning/15 text-warning-foreground" :
            "bg-destructive/10 text-destructive"
          }`}>
            <HeartPulse className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold capitalize">{health.overall}</span>
              <StatusBadge status={health.overall} />
            </div>
            <p className="text-xs text-muted-foreground">
              Last refreshed {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isFetching}
          onClick={() => queryClient.invalidateQueries({ queryKey: ["admin-platform-health"] })}
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh Health
        </Button>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {health.checks.map((check) => (
          <Card key={check.name} className="p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{check.name}</span>
              <StatusBadge status={check.status} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{check.detail}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Checked {new Date(check.checked_at).toLocaleTimeString()}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}

interface BillingSummary {
  total_active: number;
  expiring_7d: number;
  expiring_30d: number;
  expired: number;
  status_distribution: { status: string; count: number }[];
  plan_distribution: { plan_id: string; plan_name: string; active_count: number; price_monthly: number }[];
  projected_mrr: number;
  expiring_queue: {
    tenant_id: string; tenant_name: string; plan_name: string | null;
    expires_at: string; days_remaining: number; owner_email: string | null; status: string;
  }[];
  generated_at: string;
}

function BillingTab() {
  const navigate = useNavigate();
  const { data: billing, isLoading } = useQuery({
    queryKey: ["admin-billing-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_billing_summary");
      if (error) throw error;
      return data as unknown as BillingSummary;
    },
  });

  if (isLoading) return <TableSkeleton rows={5} columns={4} />;
  if (!billing) return <EmptyState icon={Wallet} title="Billing unavailable" description="Could not load billing summary." />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Active subscriptions" value={billing.total_active} icon={CheckCircle2} />
        <StatCard label="Expiring in 7 days" value={billing.expiring_7d} icon={CalendarClock} tone={billing.expiring_7d > 0 ? "warning" : "default"} />
        <StatCard label="Expiring in 30 days" value={billing.expiring_30d} icon={CalendarClock} />
        <StatCard label="Expired (still active)" value={billing.expired} icon={AlertTriangle} tone={billing.expired > 0 ? "danger" : "default"} />
        <StatCard label="Projected MRR" value={fmtMoney(billing.projected_mrr, "")} icon={Wallet} sub="From assigned plan prices, not collected revenue" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="font-medium mb-3">Plan distribution</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Price/mo</TableHead>
                <TableHead className="text-right">Active subs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billing.plan_distribution.map((p) => (
                <TableRow key={p.plan_id}>
                  <TableCell>{p.plan_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtMoney(p.price_monthly, "")}</TableCell>
                  <TableCell className="text-right font-medium">{p.active_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="p-4">
          <div className="font-medium mb-3">Status distribution</div>
          {billing.status_distribution.length === 0 ? (
            <EmptyState icon={Wallet} title="No subscriptions yet" description="No tenant has a billing subscription assigned." />
          ) : (
            <div className="space-y-2">
              {billing.status_distribution.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-sm p-2 rounded border">
                  <StatusBadge status={s.status} />
                  <span className="font-medium">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <div className="font-medium mb-3">Expiring / overdue queue (next 30 days)</div>
        {billing.expiring_queue.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing expiring soon" description="No active subscription expires within 30 days." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shop</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Days remaining</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billing.expiring_queue.map((q) => (
                <TableRow
                  key={q.tenant_id}
                  className="cursor-pointer"
                  onClick={() => navigate({ to: "/admin/shops/$id", params: { id: q.tenant_id } })}
                >
                  <TableCell className="font-medium text-primary">{q.tenant_name}</TableCell>
                  <TableCell className="text-xs">{q.plan_name ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{q.owner_email ?? "—"}</TableCell>
                  <TableCell className="text-xs">{new Date(q.expires_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <StatusBadge tone={q.days_remaining < 0 ? "danger" : q.days_remaining <= 7 ? "warning" : "neutral"}>
                      {q.days_remaining < 0 ? `${Math.abs(q.days_remaining)}d overdue` : `${q.days_remaining}d left`}
                    </StatusBadge>
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

interface FeatureFlagRow {
  key: string;
  label: string;
  description: string | null;
  default_enabled: boolean;
  plan_states: { plan_name: string; enabled: boolean }[];
  tenant_overrides: { tenant_id: string; tenant_name: string; enabled: boolean; updated_at: string }[];
}

function FeatureFlagsTab() {
  const qc = useQueryClient();
  const [overrideFor, setOverrideFor] = useState<FeatureFlagRow | null>(null);

  const { data: flags = [], isLoading } = useQuery({
    queryKey: ["admin-feature-flags"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_feature_flags");
      if (error) throw error;
      return (data as unknown as FeatureFlagRow[]) ?? [];
    },
  });

  const clearOverride = async (tenantId: string, flagKey: string) => {
    const { error } = await supabase.rpc("admin_clear_tenant_feature_override", { _tenant_id: tenantId, _flag_key: flagKey });
    if (error) return toast.error(error.message);
    toast.success("Override removed");
    qc.invalidateQueries({ queryKey: ["admin-feature-flags"] });
  };

  if (isLoading) return <TableSkeleton rows={5} columns={3} />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-2xl">
        Global default and plan-level state come from each plan's own configuration. A tenant override always wins over its plan, which wins over the global default.
      </p>
      {flags.length === 0 ? (
        <EmptyState icon={Flag} title="No feature flags" description="No flags are registered yet." />
      ) : (
        <div className="space-y-3">
          {flags.map((f) => (
            <Card key={f.key} className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {f.label}
                    <StatusBadge tone={f.default_enabled ? "success" : "neutral"}>
                      Default {f.default_enabled ? "on" : "off"}
                    </StatusBadge>
                  </div>
                  {f.description && <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>}
                </div>
                <Button size="sm" variant="outline" onClick={() => setOverrideFor(f)}>
                  <Plus className="h-4 w-4 mr-1" /> Tenant override
                </Button>
              </div>

              {f.plan_states.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {f.plan_states.map((p) => (
                    <span key={p.plan_name} className="text-[11px] px-2 py-0.5 rounded-full border">
                      {p.plan_name}: {p.enabled ? "on" : "off"}
                    </span>
                  ))}
                </div>
              )}

              {f.tenant_overrides.length > 0 && (
                <div className="mt-3 space-y-1">
                  {f.tenant_overrides.map((o) => (
                    <div key={o.tenant_id} className="flex items-center justify-between text-xs p-2 rounded border">
                      <span>{o.tenant_name}</span>
                      <div className="flex items-center gap-2">
                        <StatusBadge tone={o.enabled ? "success" : "danger"}>{o.enabled ? "Enabled" : "Disabled"}</StatusBadge>
                        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => clearOverride(o.tenant_id, f.key)}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <TenantOverrideDialog flag={overrideFor} onClose={() => setOverrideFor(null)} />
    </div>
  );
}

function TenantOverrideDialog({ flag, onClose }: { flag: FeatureFlagRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedTenant, setSelectedTenant] = useState<{ id: string; name: string } | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: results = [] } = useQuery({
    queryKey: ["admin-tenant-search", debounced],
    enabled: debounced.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("id,name").ilike("name", `%${debounced}%`).limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = async () => {
    if (!flag || !selectedTenant) return;
    setSaving(true);
    const { error } = await supabase.rpc("admin_set_tenant_feature_override", {
      _tenant_id: selectedTenant.id, _flag_key: flag.key, _enabled: enabled,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Override saved for ${selectedTenant.name}`);
    qc.invalidateQueries({ queryKey: ["admin-feature-flags"] });
    setSelectedTenant(null);
    setSearch("");
    onClose();
  };

  return (
    <Dialog open={!!flag} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Tenant override — {flag?.label}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Shop</Label>
            {selectedTenant ? (
              <div className="flex items-center justify-between rounded border p-2 text-sm">
                {selectedTenant.name}
                <Button size="sm" variant="ghost" onClick={() => setSelectedTenant(null)}>Change</Button>
              </div>
            ) : (
              <>
                <Input placeholder="Search shop by name..." value={search} onChange={(e) => setSearch(e.target.value)} />
                {results.length > 0 && (
                  <div className="border rounded divide-y">
                    {results.map((r) => (
                      <button
                        key={r.id}
                        className="w-full text-left text-sm p-2 hover:bg-muted"
                        onClick={() => setSelectedTenant(r)}
                      >
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <Label className="flex items-center justify-between gap-3 rounded border p-2 text-sm">
            <span>Enabled for this shop</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={!selectedTenant || saving}>{saving ? "Saving..." : "Save override"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrinterSettingsTab() {
  const [settings, setSettings] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => {
    getLocalPrinterSettings().then(setSettings);
  }, []);

  const save = async (patch: any) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveLocalPrinterSettings(next);
    toast.success("Printer settings updated locally");
  };

  const runTestPrint = async () => {
    if (!settings) return;
    setTestBusy(true);
    try {
      const { printInvoiceDirect, sampleInvoice } = await import("@/components/receipt");
      // Force direct print for test
      const testSettings = {
        ...settings,
        direct_print_enabled: true,
      };
      printInvoiceDirect(sampleInvoice, testSettings, "sale");
      toast.success("Test print sent", { description: "Check your printer for the sample receipt." });
    } catch (e: any) {
      toast.error("Test print failed", { description: e?.message });
    } finally {
      setTestBusy(false);
    }
  };

  if (!settings) return <TableSkeleton rows={4} columns={2} />;

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4 max-w-2xl">
        <div>
          <h3 className="text-lg font-medium">Local Printer Settings</h3>
          <p className="text-sm text-muted-foreground">These settings are specific to THIS computer and browser.</p>
        </div>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>Selected Printer Name</Label>
            <Input 
              value={settings.printer_name || ""} 
              onChange={(e) => save({ printer_name: e.target.value })} 
              placeholder="e.g. POS-80, Epson TM-T20II"
            />
            <p className="text-[11px] text-muted-foreground">
              Enter the exact name of the printer as it appears in Windows/OS.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Paper Size</Label>
              <Select value={settings.paper_width} onValueChange={(v) => save({ paper_width: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="58mm">58mm Thermal</SelectItem>
                  <SelectItem value="80mm">80mm Thermal</SelectItem>
                  <SelectItem value="A4">A4 Standard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex flex-col justify-end space-y-2">
               <Label className="flex items-center justify-between gap-3 rounded border p-2 text-sm">
                <span>One-Click Direct Print</span>
                <Switch 
                  checked={!!settings.direct_print_enabled} 
                  onCheckedChange={(v) => save({ direct_print_enabled: v })} 
                />
              </Label>
            </div>
          </div>

          <div className="border-t pt-4">
            <Button onClick={runTestPrint} disabled={testBusy} variant="outline" className="w-full">
              <Printer className="h-4 w-4 mr-2" />
              {testBusy ? "Printing..." : "Run Test Print"}
            </Button>
          </div>
        </div>
      </Card>
      
      <Card className="p-4 bg-muted/30 max-w-2xl">
        <div className="flex gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="text-xs space-y-1">
            <div className="font-semibold text-amber-900 uppercase tracking-wider">Direct Print Requirements</div>
            <p>1. You must have the <b>Tillix Local Print Agent</b> installed and running on this computer.</p>
            <p>2. The browser must have permission to communicate with the agent.</p>
            <p>3. If direct printing fails, the system will fallback to the standard browser print preview.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}



function DashboardTab({ setActiveTab }: { setActiveTab: (tab: string) => void }) {
  const { data: tenants = [] } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_tenants");
      if (error) throw error;
      return (data as TenantRow[]) ?? [];
    },
  });

  const { data: summary } = useQuery({
    queryKey: ["admin-security-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_security_summary");
      if (error) throw error;
      return (data as unknown as SecuritySummary) ?? null;
    },
  });

  const { data: errorCount = 0 } = useQuery({
    queryKey: ["admin-errors-count"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_recent_errors", { _limit: 100 });
      if (error) throw error;
      return ((data as any[]) ?? []).length;
    },
  });

  const totals = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    return {
      total: tenants.length,
      active: tenants.filter((t) => t.status === "active").length,
      pending: tenants.filter((t) => t.status === "pending").length,
      suspended: tenants.filter((t) => t.status === "suspended").length,
      // "Expired" = an active/pending tenant whose subscription end date has
      // already passed — derived entirely from subscription_expires_at,
      // already returned by admin_list_tenants, no new data source.
      expired: tenants.filter(
        (t) => t.status !== "archived" && t.subscription_expires_at && new Date(t.subscription_expires_at).getTime() < now,
      ).length,
      revenue: tenants.reduce((a, t) => a + Number(t.sales_total || 0), 0),
      products: tenants.reduce((a, t) => a + Number(t.product_count || 0), 0),
      orders: tenants.reduce((a, t) => a + Number(t.sales_count || 0), 0),
      newThisWeek: tenants.filter((t) => new Date(t.created_at).getTime() >= weekAgo).length,
    };
  }, [tenants]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total shops"
          value={totals.total}
          icon={Store}
          sub={totals.newThisWeek > 0 ? `+${totals.newThisWeek} this week` : undefined}
          onClick={() => setActiveTab("tenants")}
        />
        <StatCard
          label="Active"
          value={totals.active}
          icon={CheckCircle2}
          tone="success"
          onClick={() => setActiveTab("tenants")}
        />
        <StatCard
          label="Suspended"
          value={totals.suspended}
          icon={Ban}
          tone={totals.suspended ? "warning" : "default"}
          onClick={() => setActiveTab("tenants")}
        />
        <StatCard
          label="Expired"
          value={totals.expired}
          icon={CalendarClock}
          tone={totals.expired ? "danger" : "default"}
          onClick={() => setActiveTab("tenants")}
        />
        <StatCard
          label="Total products"
          value={totals.products.toLocaleString()}
          icon={Package}
        />
        <StatCard
          label="Total sales/orders"
          value={totals.orders.toLocaleString()}
          icon={ShoppingCart}
        />
        <StatCard
          label="Security alerts"
          value={summary?.critical_24h ?? 0}
          icon={ShieldAlert}
          tone={summary?.critical_24h ? "danger" : "default"}
          onClick={() => setActiveTab("security")}
        />
        <StatCard
          label="System errors"
          value={errorCount}
          icon={Bug}
          tone={errorCount ? "danger" : "default"}
          onClick={() => setActiveTab("errors")}
        />
      </div>

      <StatCard label="Total Revenue" value={fmtMoney(totals.revenue, "")} icon={Wallet} tone="primary" />

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Recent Shops
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setActiveTab("tenants")}>View all</Button>
          </div>
          <div className="space-y-3">
            {[...tenants].sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5).map(t => (
              <div key={t.id} className="flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{t.owner_email}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right flex flex-col">
                    <span className="text-xs font-medium">{fmtMoney(t.sales_total || 0, "PKR")}</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(t.created_at).toLocaleDateString()}</span>
                  </div>
                  <Button size="icon" variant="ghost" asChild className="h-8 w-8">
                    <Link to="/admin/shops/$id" params={{ id: t.id }}><Eye className="h-4 w-4" /></Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-warning" />
              Recent Security Events
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setActiveTab("security")}>Logs</Button>
          </div>
          <SecurityEventsMiniList />
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Recent Admin Activity
            </h3>
          </div>
          <RecentActivityMiniList />
        </Card>
      </div>
    </div>
  );
}

function RecentActivityMiniList() {
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-audit-logs", "mini"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_action_log_view")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data as unknown as AdminActionLog[]) ?? [];
    },
  });

  if (rows.length === 0) return <EmptyState icon={Activity} title="No activity yet" description="Admin actions will show up here." />;

  return (
    <div className="space-y-2">
      {rows.map((l) => (
        <div key={l.id} className="text-xs p-2 rounded border flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-medium uppercase text-[10px] tracking-wide">{l.action}</span>
            <span className="text-muted-foreground truncate">{l.tenant_name ?? l.entity_type ?? "—"}</span>
          </div>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function SecurityEventsMiniList() {
  const { data: events = [] } = useQuery({
    queryKey: ["admin-security-events", "all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_security_events", { _limit: 5 });
      if (error) throw error;
      return (data as SecurityEvent[]) ?? [];
    },
  });

  if (events.length === 0) return <EmptyState icon={ShieldCheck} title="Clean logs" description="No security events recorded." />;

  return (
    <div className="space-y-2">
      {events.map(e => (
        <div key={e.id} className="text-xs p-2 rounded border flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{e.event_type}</span>
            <span className="text-muted-foreground">{e.ip_address || e.email || "System"}</span>
          </div>
          <StatusBadge tone={e.severity === "critical" ? "danger" : e.severity === "warning" ? "warning" : "neutral"}>
            {e.severity}
          </StatusBadge>
        </div>
      ))}
    </div>
  );
}

/**
 * A short, human-readable warning when a tenant looks inactive or
 * problematic, derived entirely from data admin_list_tenants already
 * returns — no separate query, no invented metric.
 */
function tenantHealthWarning(t: TenantRow): string | null {
  if (t.status === "archived") return null;
  if (t.subscription_expires_at && new Date(t.subscription_expires_at).getTime() < Date.now()) {
    return "Subscription expired";
  }
  if (t.plan_max_products != null && t.product_count > t.plan_max_products) {
    return `Over product limit (${t.product_count}/${t.plan_max_products})`;
  }
  if (t.plan_max_users != null && t.member_count > t.plan_max_users) {
    return `Over seat limit (${t.member_count}/${t.plan_max_users})`;
  }
  if (t.status === "active" && t.last_activity_at) {
    const daysSince = (Date.now() - new Date(t.last_activity_at).getTime()) / 86_400_000;
    if (daysSince >= 30) return `No activity in ${Math.floor(daysSince)} days`;
  }
  if (t.subscription_expires_at) {
    const daysLeft = (new Date(t.subscription_expires_at).getTime() - Date.now()) / 86_400_000;
    if (daysLeft >= 0 && daysLeft <= 7) return `Expiring in ${Math.ceil(daysLeft)}d`;
  }
  if (t.plan_max_products != null && t.product_count >= t.plan_max_products * 0.9) {
    return `Near product limit (${t.product_count}/${t.plan_max_products})`;
  }
  if (t.plan_max_users != null && t.member_count >= t.plan_max_users * 0.9) {
    return `Near seat limit (${t.member_count}/${t.plan_max_users})`;
  }
  return null;
}

function TenantsTab() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { has } = useAdminAccess();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "pending" | "suspended" | "archived">("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [suspendDialog, setSuspendDialog] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: "", name: "" });
  const [archiveDialog, setArchiveDialog] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: "", name: "" });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: "", name: "" });
  const [isDeleting, setIsDeleting] = useState(false);

  // Debounce search so we don't hit the DB on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to the first page whenever the search or status filter changes.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, filter]);

  // Unbounded, shared with Dashboard/Errors tab under the same query key —
  // used only for the totals cards, which need true global counts.
  const { data: allTenants = [] } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_tenants");
      if (error) throw error;
      return (data as TenantRow[]) ?? [];
    },
  });

  const totals = useMemo(() => {
    return {
      total: allTenants.length,
      active: allTenants.filter((t) => t.status === "active").length,
      pending: allTenants.filter((t) => t.status === "pending").length,
      suspended: allTenants.filter((t) => t.status === "suspended").length,
      revenue: allTenants.reduce((a, t) => a + Number(t.sales_total || 0), 0),
    };
  }, [allTenants]);

  // Real server-side search/filter/pagination for the table itself.
  const { data: page_, isLoading } = useQuery({
    queryKey: ["admin-tenants-page", debouncedSearch, filter, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_tenants", {
        _search: debouncedSearch || undefined,
        _status: filter === "all" ? undefined : filter,
        _limit: pageSize,
        _offset: page * pageSize,
      });
      if (error) throw error;
      const rows = (data as (TenantRow & { total_count: number })[]) ?? [];
      return { rows, total: rows[0]?.total_count ?? 0 };
    },
  });
  const filtered = page_?.rows ?? [];
  const totalFiltered = page_?.total ?? 0;
  const pageStart = totalFiltered === 0 ? 0 : page * pageSize + 1;
  const pageEnd = Math.min((page + 1) * pageSize, totalFiltered);

  const setStatus = async (id: string, status: string, reason?: string) => {
    const { error } = await supabase.rpc("admin_set_tenant_status", {
      _tenant_id: id, _status: status, _reason: reason ?? undefined,
    });
    if (error) return toast.error(error.message);
    toast.success(`Tenant ${status}`);
    qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    qc.invalidateQueries({ queryKey: ["admin-tenants-page"] });
    qc.invalidateQueries({ queryKey: ["admin-tenant-detail", id] });
  };

  const suspend = (id: string, name: string) => {
    setSuspendDialog({ open: true, id, name });
  };

  const archive = (id: string, name: string) => {
    setArchiveDialog({ open: true, id, name });
  };

  const removeShop = (id: string, name: string) => {
    setDeleteDialog({ open: true, id, name });
  };


  const handleConfirmDelete = async (reason: string) => {
    const { id, name } = deleteDialog;
    setIsDeleting(true);
    try {
      let done = false;
      while (!done) {
        const { data, error } = await supabase.rpc("admin_delete_tenant", {
          _tenant_id: id,
          _confirm: name,
          _reason: reason,
        });
        if (error) throw error;
        done = Boolean(data && typeof data === "object" && "done" in data && data.done);
      }
      toast.success(`Deleted "${name}"`);
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
      qc.invalidateQueries({ queryKey: ["admin-tenants-page"] });
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsDeleting(false);
    }
  };



  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total shops" value={totals.total} icon={Store} onClick={() => setFilter("all")} />
        <StatCard label="Active" value={totals.active} icon={CheckCircle2} tone="success" onClick={() => setFilter("active")} />
        <StatCard label="Pending" value={totals.pending} icon={Clock} tone="warning" onClick={() => setFilter("pending")} />
        <StatCard label="Suspended" value={totals.suspended} icon={Ban} tone="danger" onClick={() => setFilter("suspended")} />
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
              <TableHead>Expiry</TableHead>
              <TableHead>Last activity</TableHead>
              <TableHead className="text-right">Users</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={10} className="py-4"><TableSkeleton rows={5} columns={9} /></TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={10} className="py-8">
                <EmptyState title="No shops found" description="Try a different search or filter" icon={Store} />
              </TableCell></TableRow>
            )}
            {filtered.map((t) => {
              const health = tenantHealthWarning(t);
              return (
              <TableRow key={t.id} className="group cursor-pointer" onClick={() => navigate({ to: "/admin/shops/$id", params: { id: t.id } })}>
                <TableCell>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{t.id.slice(0, 8)}</div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">{t.owner_name || "—"}</div>
                  <div className="text-[11px] text-muted-foreground">{t.owner_email || "—"}</div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={t.status} />
                    {health && (
                      <span title={health}>
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell><span className="capitalize text-sm">{t.plan || "—"}</span></TableCell>
                <TableCell>
                  <ExpiryCell tenantId={t.id} expiresAt={t.subscription_expires_at} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  <div>{t.last_activity_at ? new Date(t.last_activity_at).toLocaleDateString() : "—"}</div>
                  <div className="text-[10px]">Login: {t.last_login_at ? new Date(t.last_login_at).toLocaleDateString() : "—"}</div>
                </TableCell>

                <TableCell className="text-right text-sm">
                  {t.plan_max_users != null ? (
                    <span className={t.member_count > t.plan_max_users ? "text-destructive font-medium" : ""}>
                      {t.member_count}/{t.plan_max_users}
                    </span>
                  ) : t.member_count}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {t.plan_max_products != null ? (
                    <span className={t.product_count > t.plan_max_products ? "text-destructive font-medium" : ""}>
                      {t.product_count}/{t.plan_max_products}
                    </span>
                  ) : t.product_count}
                </TableCell>
                <TableCell className="text-right text-sm">
                  <div className="font-medium">{t.sales_count}</div>
                  <div className="text-[11px] text-muted-foreground">{fmtMoney(t.sales_total)}</div>
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" asChild>
                      <Link to="/admin/shops/$id" params={{ id: t.id }}><Eye className="h-4 w-4" /></Link>
                    </Button>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon"><Plus className="h-4 w-4" /></Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-48 p-1" align="end">
                        {t.status !== "active" && has("shops.approve") && (
                          <Button variant="ghost" className="w-full justify-start text-emerald-600 h-8" onClick={() => setStatus(t.id, "active")}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Approve
                          </Button>
                        )}
                        {t.status !== "suspended" && has("shops.suspend") && (
                          <Button variant="ghost" className="w-full justify-start text-amber-600 h-8" onClick={() => suspend(t.id, t.name)}>
                            <Ban className="h-3.5 w-3.5 mr-2" /> Suspend
                          </Button>
                        )}
                        {t.status !== "archived" && has("shops.archive") && (
                          <Button variant="ghost" className="w-full justify-start text-muted-foreground h-8" onClick={() => archive(t.id, t.name)}>
                            <Archive className="h-3.5 w-3.5 mr-2" /> Archive
                          </Button>
                        )}

                        {has("shops.delete") && (
                          <Button variant="ghost" className="w-full justify-start text-destructive h-8" onClick={() => removeShop(t.id, t.name)}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </Button>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2 border-t border-border/40 mt-2">
          <div className="text-xs text-muted-foreground font-medium">
            Showing <span className="text-foreground">{pageStart}</span> to{" "}
            <span className="text-foreground">{pageEnd}</span> of{" "}
            <span className="text-foreground">{totalFiltered}</span> shops
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
              Page {page + 1} of {Math.max(1, Math.ceil(totalFiltered / pageSize))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-semibold"
              onClick={() => setPage((p) => p + 1)}
              disabled={pageEnd >= totalFiltered}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      <TypedConfirmDialog
        open={suspendDialog.open}
        onOpenChange={(open) => setSuspendDialog(prev => ({ ...prev, open }))}
        title="Suspend Shop"
        description={`Are you sure you want to suspend "${suspendDialog.name}"? This will block access for all staff members.`}
        confirmLabel="Suspend"
        requireReason
        destructive
        onConfirm={async (reason) => { await setStatus(suspendDialog.id, "suspended", reason); }}
      />

      <TypedConfirmDialog
        open={archiveDialog.open}
        onOpenChange={(o) => setArchiveDialog(prev => ({ ...prev, open: o }))}
        title="Archive Shop"
        description={`Are you sure you want to archive "${archiveDialog.name}"?`}
        confirmLabel="Archive"
        requireReason
        destructive
        onConfirm={async (reason) => { await setStatus(archiveDialog.id, "archived", reason); }}
      />

      <TypedConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog(prev => ({ ...prev, open }))}
        title="Permanently Delete Shop"
        description={`This will permanently delete "${deleteDialog.name}" and ALL its data (products, sales, customers, expenses, staff). This action is irreversible.`}
        confirmText={deleteDialog.name}
        confirmLabel="Delete Everything"
        requireReason
        destructive
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

function ExpiryCell({ tenantId, expiresAt }: { tenantId: string; expiresAt: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(expiresAt ? new Date(expiresAt).toISOString().slice(0, 10) : "");
  const [busy, setBusy] = useState(false);

  const now = Date.now();
  const exp = expiresAt ? new Date(expiresAt).getTime() : null;
  const daysLeft = exp !== null ? Math.ceil((exp - now) / 86400000) : null;
  const expired = exp !== null && exp < now;
  const soon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;

  const save = async () => {
    setBusy(true);
    const iso = value ? new Date(value + "T23:59:59").toISOString() : null;
    const { error } = await supabase.rpc("admin_set_tenant_expiry", {
      _tenant_id: tenantId,
      _expires_at: iso as any,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Expiry updated");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    qc.invalidateQueries({ queryKey: ["admin-tenants-page"] });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="text-left group">
          <div className="text-sm">
            {expiresAt ? new Date(expiresAt).toLocaleDateString() : <span className="text-muted-foreground">Not set</span>}
          </div>
          {daysLeft !== null && (
            <div className={
              "text-xs " +
              (expired ? "text-destructive font-medium" : soon ? "text-amber-600" : "text-muted-foreground")
            }>
              {expired ? `Expired ${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}
            </div>
          )}
          <div className="text-[10px] text-primary opacity-0 group-hover:opacity-100">Click to change</div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2" align="start">
        <Label className="text-xs">Shop expiry date</Label>
        <Input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={busy} className="flex-1">
            <CalendarClock className="h-4 w-4 mr-1" /> Save
          </Button>
          {expiresAt && (
            <Button size="sm" variant="outline" onClick={() => { setValue(""); save(); }} disabled={busy}>
              Clear
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">Shop is blocked when the date passes.</p>
      </PopoverContent>
    </Popover>
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
      const { data, error } = await supabase.rpc("admin_tenant_detail", { _tenant_id: tenantId! });
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
              <StatCard label="Products" value={data.stats.products} icon={Package} />
              <StatCard label="Customers" value={data.stats.customers} icon={Users} />
              <StatCard label="Sales" value={data.stats.sales_count} icon={ShoppingCart} />
              <StatCard label="Revenue" value={fmtMoney(data.stats.sales_total, "")} />
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

type ErrorRow = {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  error_type: string;
  error_message: string;
  page_or_module: string | null;
  stack_trace: string | null;
  created_at: string;
};

interface ErrorObservability {
  trend: { today: number; last_7d: number; previous_7d: number };
  top_recurring: {
    error_type: string; page_or_module: string | null; count: number; unresolved_count: number;
    affected_shops: number; first_seen: string; last_seen: string; sample_message: string;
  }[];
  recently_resolved: {
    id: string; tenant_id: string | null; error_type: string; error_message: string;
    page_or_module: string | null; resolved_at: string; resolved_by: string | null; resolution_note: string | null;
  }[];
}

function ErrorsTab() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [retryAllOpen, setRetryAllOpen] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const { data: observability } = useQuery({
    queryKey: ["admin-error-observability"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_error_observability");
      if (error) throw error;
      return data as unknown as ErrorObservability;
    },
  });

  const unresolveOne = async (id: string) => {
    setBusyId(id);
    const { error } = await supabase.rpc("admin_unresolve_error", { _id: id });
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Error reopened");
    qc.invalidateQueries({ queryKey: ["admin-errors"] });
    qc.invalidateQueries({ queryKey: ["admin-errors-count"] });
    qc.invalidateQueries({ queryKey: ["admin-error-observability"] });
  };

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-errors"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_recent_errors", { _limit: 100 });
      if (error) throw error;
      return (data as ErrorRow[]) ?? [];
    },
    refetchInterval: 30_000,
  });
  const { data: tenants = [] } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_tenants");
      if (error) throw error;
      return (data as TenantRow[]) ?? [];
    },
  });
  const tenantMap = useMemo(() => {
    const m = new Map<string, TenantRow>();
    for (const t of tenants) m.set(t.id, t);
    return m;
  }, [tenants]);

  const byShop = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const key = r.tenant_id ?? "unknown";
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .map(([tid, count]) => ({ tid, count, name: tenantMap.get(tid)?.name ?? "Unknown shop" }))
      .sort((a, b) => b.count - a.count);
  }, [rows, tenantMap]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-errors"] });
    qc.invalidateQueries({ queryKey: ["admin-errors-count"] });
  };

  const resolveOne = async (row: ErrorRow, note?: string) => {
    setBusyId(row.id);
    const { error } = await supabase.rpc("admin_resolve_error", { _id: row.id, _note: note ?? undefined });
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Error resolved");
    invalidate();
  };

  const retryOne = async (row: ErrorRow) => {
    setBusyId(row.id);
    const { note, autoResolved } = await autoRemediate(row);
    if (!autoResolved) {
      setBusyId(null);
      toast.info(note, { description: "Not resolved automatically — review and resolve manually if this is safe to dismiss." });
      return;
    }
    const { error } = await supabase.rpc("admin_resolve_error", { _id: row.id, _note: note });
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(note);
    invalidate();
  };

  const clearAll = async () => {
    setBulkBusy(true);
    const { data, error } = await supabase.rpc("admin_resolve_errors_bulk", {
      _note: "Bulk cleared by developer",
    });
    setBulkBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Resolved ${data ?? 0} errors`);
    invalidate();
  };

  const retryAll = async () => {
    setBulkBusy(true);
    let retried = 0;
    let skipped = 0;
    for (const r of rows) {
      const { note, autoResolved } = await autoRemediate(r);
      if (!autoResolved) { skipped++; continue; }
      const { error } = await supabase.rpc("admin_resolve_error", { _id: r.id, _note: note });
      if (!error) retried++;
    }
    setBulkBusy(false);
    toast.success(`Retried and resolved ${retried} of ${rows.length}${skipped ? ` — ${skipped} need manual review` : ""}`);
    invalidate();
  };

  return (
    <div className="space-y-3">
      {observability && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Errors today" value={observability.trend.today} icon={AlertTriangle} />
          <StatCard label="Last 7 days" value={observability.trend.last_7d} icon={AlertTriangle}
            delta={observability.trend.previous_7d > 0
              ? ((observability.trend.last_7d - observability.trend.previous_7d) / observability.trend.previous_7d) * 100
              : undefined}
            sub={`${observability.trend.previous_7d} in the previous 7 days`} />
          <StatCard label="Recurring groups (30d)" value={observability.top_recurring.length} icon={Bug} />
        </div>
      )}

      {observability && observability.top_recurring.length > 0 && (
        <Card className="p-3">
          <div className="font-medium text-sm mb-2">Top recurring errors (last 30 days)</div>
          <p className="text-xs text-muted-foreground mb-2">Grouped by error type + where it happened, so repeats don't look like separate problems.</p>
          <div className="space-y-1.5">
            {observability.top_recurring.map((g) => (
              <div key={`${g.error_type}-${g.page_or_module}`} className="text-xs p-2 rounded border flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{g.error_type} <span className="text-muted-foreground font-normal">· {g.page_or_module ?? "—"}</span></div>
                  <div className="text-muted-foreground truncate max-w-md" title={g.sample_message}>{g.sample_message}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-muted-foreground">{g.affected_shops} shop{g.affected_shops === 1 ? "" : "s"}</span>
                  {g.unresolved_count > 0 && <StatusBadge tone="danger">{g.unresolved_count} open</StatusBadge>}
                  <StatusBadge tone="neutral">{g.count}x</StatusBadge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" variant={!showResolved ? "default" : "outline"} onClick={() => setShowResolved(false)}>Unresolved</Button>
        <Button size="sm" variant={showResolved ? "default" : "outline"} onClick={() => setShowResolved(true)}>Recently resolved</Button>
      </div>

      {showResolved ? (
        <Card className="p-3">
          {!observability || observability.recently_resolved.length === 0 ? (
            <EmptyState icon={Check} title="Nothing resolved yet" description="Resolved errors will show up here." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resolved</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {observability.recently_resolved.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(e.resolved_at).toLocaleString()}</TableCell>
                    <TableCell><StatusBadge tone="neutral">{e.error_type}</StatusBadge></TableCell>
                    <TableCell className="max-w-md truncate" title={e.error_message}>{e.error_message}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{e.resolution_note ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => unresolveOne(e.id)} disabled={busyId === e.id}>
                        Unresolve
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      ) : (
      <>
      {byShop.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <div className="font-medium text-sm">Affected shops</div>
            <span className="text-xs text-muted-foreground">Which shop has which issue count</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setRetryAllOpen(true)} disabled={bulkBusy || !rows.length}>
                <RotateCcw className="h-4 w-4 mr-1" /> Retry all
              </Button>
              <Button size="sm" variant="outline" onClick={() => setClearAllOpen(true)} disabled={bulkBusy || !rows.length}>
                <Check className="h-4 w-4 mr-1" /> Clear all
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {byShop.map((s) => (
              <Link
                key={s.tid}
                to="/admin/shops/$id"
                params={{ id: s.tid }}
                className="inline-flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs hover:bg-destructive/20"
              >
                <span className="font-medium">{s.name}</span>
                <span className="rounded-full bg-destructive px-1.5 text-destructive-foreground">{s.count}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Where</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={6} className="py-4"><TableSkeleton rows={5} columns={6} /></TableCell></TableRow>
            )}
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8">
                <EmptyState icon={CheckCircle2} title="All clear" description="No unresolved errors — everything is running smoothly." />
              </TableCell></TableRow>
            )}
            {rows.map((e) => {
              const shop = e.tenant_id ? tenantMap.get(e.tenant_id) : null;
              const busy = busyId === e.id;
              return (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">
                    {shop ? (
                      <Link to="/admin/shops/$id" params={{ id: shop.id }} className="font-medium hover:underline">
                        {shop.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{e.tenant_id ? "Unknown" : "—"}</span>
                    )}
                  </TableCell>
                  <TableCell><StatusBadge tone="danger">{e.error_type}</StatusBadge></TableCell>
                  <TableCell className="max-w-md truncate" title={e.error_message}>{e.error_message}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{e.page_or_module ?? "—"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => retryOne(e)} disabled={busy} title="Retry known recovery action, resolve only if it actually succeeds">
                        <RotateCcw className="h-4 w-4 mr-1" /> Retry & resolve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => resolveOne(e)} disabled={busy} title="Mark as resolved">
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      </>
      )}

      <TypedConfirmDialog
        open={clearAllOpen}
        onOpenChange={setClearAllOpen}
        title="Resolve all errors"
        description={`Mark all ${rows.length} unresolved errors as resolved? This does not fix anything — it only clears them from this list.`}
        confirmLabel="Resolve all"
        onConfirm={async () => { await clearAll(); }}
      />

      <TypedConfirmDialog
        open={retryAllOpen}
        onOpenChange={setRetryAllOpen}
        title="Retry all errors"
        description={`Attempt the known recovery action for each of the ${rows.length} unresolved errors. Only ones that actually recover will be marked resolved — the rest are left for manual review.`}
        confirmLabel="Retry all"
        onConfirm={async () => { await retryAll(); }}
      />
    </div>

  );
}

type SecurityEvent = {
  id: string;
  event_type: string;
  severity: string;
  ip_address: string | null;
  user_agent: string | null;
  email: string | null;
  path: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type BlocklistRow = {
  id: string;
  kind: "ip" | "email";
  value: string;
  reason: string | null;
  auto_blocked: boolean;
  expires_at: string | null;
  created_at: string;
};

type SupportSessionRow = {
  id: string;
  admin_id: string;
  tenant_id: string;
  tenant_name: string | null;
  reason: string;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  is_active: boolean;
};


function SecurityTab() {
  const qc = useQueryClient();
  const { isSuperAdmin } = useAdminAccess();
  const [severity, setSeverity] = useState<"all" | "info" | "warning" | "critical">("all");
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [debouncedEventType, setDebouncedEventType] = useState("");
  const [eventsFrom, setEventsFrom] = useState("");
  const [eventsTo, setEventsTo] = useState("");
  const [blockOpen, setBlockOpen] = useState(false);
  const [clearDialog, setClearDialog] = useState<{ open: boolean; severity?: "info" | "warning" | "critical"; olderDays?: number }>({ open: false });

  const [auditActor, setAuditActor] = useState("all");
  const [auditAction, setAuditAction] = useState("");
  const [debouncedAuditAction, setDebouncedAuditAction] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedEventType(eventTypeFilter.trim()), 300);
    return () => clearTimeout(t);
  }, [eventTypeFilter]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedAuditAction(auditAction.trim()), 300);
    return () => clearTimeout(t);
  }, [auditAction]);

  const list = useServerFn(listAdminStaff);
  const { data: adminStaff = [] } = useQuery({
    queryKey: ["admin-staff"],
    queryFn: async () => ((await list()) as AdminStaffRow[]) ?? [],
  });
  const adminEmailMap = useMemo(() => new Map(adminStaff.map((s) => [s.user_id, s.email])), [adminStaff]);

  const { data: supportSessions = [] } = useQuery({
    queryKey: ["admin-support-sessions-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_support_sessions_view")
        .select("*")
        .eq("is_active", true)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as SupportSessionRow[]) ?? [];
    },
    refetchInterval: 30_000,
  });

  const endSupportSession = async (id: string) => {
    const { error } = await supabase.rpc("admin_end_support_session", { _session_id: id });
    if (error) return toast.error(error.message);
    toast.success("Support session ended");
    qc.invalidateQueries({ queryKey: ["admin-support-sessions-active"] });
  };

  const { data: summary } = useQuery({
    queryKey: ["admin-security-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_security_summary");
      if (error) throw error;
      return (data as unknown as SecuritySummary) ?? null;
    },
    refetchInterval: 30_000,
  });

  // Direct read of security_events (it already has its own super-admin-only
  // RLS SELECT policy, same authorization as the admin_list_security_events
  // RPC) so event-type and date-range filters can be applied server-side
  // without needing a new RPC signature.
  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["admin-security-events", severity, debouncedEventType, eventsFrom, eventsTo],
    queryFn: async () => {
      let q = supabase.from("security_events").select("*").order("created_at", { ascending: false }).limit(200);
      if (severity !== "all") q = q.eq("severity", severity);
      if (debouncedEventType) q = q.ilike("event_type", `%${debouncedEventType}%`);
      if (eventsFrom) q = q.gte("created_at", new Date(eventsFrom + "T00:00:00").toISOString());
      if (eventsTo) q = q.lte("created_at", new Date(eventsTo + "T23:59:59").toISOString());
      const { data, error } = await q;
      if (error) throw error;
      return (data as SecurityEvent[]) ?? [];
    },
    refetchInterval: 30_000,
  });

  const { data: blocks = [], isLoading: blocksLoading } = useQuery({
    queryKey: ["admin-security-blocks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("security_blocklist")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as BlocklistRow[]) ?? [];
    },
  });

  const { data: auditLogs = [], isLoading: auditLoading } = useQuery({
    queryKey: ["admin-audit-logs", auditActor, debouncedAuditAction, auditFrom, auditTo],
    queryFn: async () => {
      let q = supabase.from("admin_action_log_view").select("*").order("created_at", { ascending: false }).limit(100);
      if (auditActor !== "all") q = q.eq("actor_id", auditActor);
      if (debouncedAuditAction) q = q.ilike("action", `%${debouncedAuditAction}%`);
      if (auditFrom) q = q.gte("created_at", new Date(auditFrom + "T00:00:00").toISOString());
      if (auditTo) q = q.lte("created_at", new Date(auditTo + "T23:59:59").toISOString());
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as AdminActionLog[]) ?? [];
    },
  });



  const unblock = async (id: string) => {
    const { error } = await supabase.rpc("admin_unblock_identifier", { _id: id });
    if (error) return toast.error(error.message);
    toast.success("Unblocked");
    qc.invalidateQueries({ queryKey: ["admin-security-blocks"] });
    qc.invalidateQueries({ queryKey: ["admin-security-summary"] });
  };

  const clearEvents = (severity?: "info" | "warning" | "critical", olderDays?: number) => {
    setClearDialog({ open: true, severity, olderDays });
  };

  const handleConfirmClear = async (reason: string) => {
    const { severity, olderDays } = clearDialog;
    const { data, error } = await supabase.rpc("admin_clear_security_events", {
      _severity: severity ?? undefined,
      _older_than_days: olderDays ?? undefined,
      _reason: reason,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Cleared ${data ?? 0} events`);
    qc.invalidateQueries({ queryKey: ["admin-security-events"] });
    qc.invalidateQueries({ queryKey: ["admin-security-summary"] });
    qc.invalidateQueries({ queryKey: ["admin-audit-logs"] });
  };



  const blockFromEvent = async (e: SecurityEvent) => {
    const kind = e.ip_address ? "ip" : e.email ? "email" : null;
    const value = e.ip_address ?? e.email;
    if (!kind || !value) return toast.error("This event has no IP or email to block");
    const { error } = await supabase.rpc("admin_block_identifier", {
      _kind: kind, _value: value, _reason: `Blocked from event: ${e.event_type}`, _hours: 24,
    });
    if (error) return toast.error(error.message);
    toast.success(`${kind === "ip" ? "IP" : "Email"} blocked for 24h`);
    qc.invalidateQueries({ queryKey: ["admin-security-blocks"] });
    qc.invalidateQueries({ queryKey: ["admin-security-summary"] });
  };



  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Events (24h)" value={summary?.total_24h ?? 0} icon={ShieldAlert} />
        <StatCard label="Failed logins (24h)" value={summary?.failed_logins_24h ?? 0} icon={AlertTriangle} tone="warning" />
        <StatCard label="Critical (24h)" value={summary?.critical_24h ?? 0} icon={ShieldAlert} tone="danger" />
        <StatCard label="Active blocks" value={summary?.active_blocks ?? 0} icon={Lock} tone="danger" />
        <StatCard label="Unique IPs (24h)" value={summary?.unique_ips_24h ?? 0} icon={Users} />
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <div className="font-medium text-sm">Yeh errors kya matlab rakhte hain — aur inka hal</div>
        </div>
        <div className="grid md:grid-cols-2 gap-3 text-xs">
          <div className="rounded-md border p-3">
            <div className="font-medium mb-1">🔴 login_failed / login_rate_limited</div>
            <div className="text-muted-foreground mb-2">Koi ghalat password bar bar try kar raha hai — brute force ki koshish.</div>
            <div><b>Hal:</b> "Failed logins (24h)" 5 se zyada ho to us IP ya email ko event row ke <i>Block</i> button se 24 ghante ke liye block kar dein. Agar shop owner khud bhool gaya hai to <i>/admin → shop → Reset owner password</i> se naya password de dein.</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="font-medium mb-1">🟡 suspicious_activity / rate_limit_hit</div>
            <div className="text-muted-foreground mb-2">Ek hi IP se buhat saari requests / unusual pattern.</div>
            <div><b>Hal:</b> IP ko 24h ke liye block karo. Baar baar wahi IP aaye to permanent block (Block IP or email → hours khaali chhorein).</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="font-medium mb-1">🔴 unauthorized_access / forbidden</div>
            <div className="text-muted-foreground mb-2">Koi cashier ya user aisi jaga pahunchne ki koshish kar raha hai jahan uski permission nahi.</div>
            <div><b>Hal:</b> Us user ki permissions <i>/shop-admin</i> ya <i>/users</i> se check karein. Zaroorat ho to us shop ko suspend kar dein.</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="font-medium mb-1">⚪ session_started / password_changed / info events</div>
            <div className="text-muted-foreground mb-2">Ye normal audit hain — koi khatra nahi.</div>
            <div><b>Hal:</b> Kuch karne ki zaroorat nahi. Log saaf karna ho to niche "Clear info events" button use karein.</div>
          </div>
          <div className="rounded-md border p-3 md:col-span-2">
            <div className="font-medium mb-1">🟢 Tab dobara green kab hoga?</div>
            <div className="text-muted-foreground">Jab 24 ghante mein: Critical = 0, Active blocks = 0, aur Failed logins &lt; 5 ho jayen. Purane events "Clear old (7d+)" se hata dein — jo blocks lagaye hain wo blocklist mein alag rehte hain, kabhi nahi jaate.</div>
          </div>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-3">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            <div className="font-medium">Blocklist</div>
            <span className="text-xs text-muted-foreground">Blocked IPs & emails cannot sign in</span>
          </div>
          <Button size="sm" onClick={() => setBlockOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Block IP or email
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {blocksLoading && (
              <TableRow><TableCell colSpan={6} className="py-4"><TableSkeleton rows={3} columns={5} /></TableCell></TableRow>
            )}
            {!blocksLoading && blocks.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8">
                <EmptyState icon={ShieldCheck} title="Nothing blocked" description="No IPs or emails currently blocked." />
              </TableCell></TableRow>
            )}
            {blocks.map((b) => (
              <TableRow key={b.id}>
                <TableCell><StatusBadge tone={b.kind === "ip" ? "warning" : "neutral"}>{b.kind}</StatusBadge></TableCell>
                <TableCell className="font-mono text-xs">{b.value}</TableCell>
                <TableCell className="max-w-sm truncate text-xs" title={b.reason ?? ""}>{b.reason ?? "—"}</TableCell>
                <TableCell className="text-xs">
                  {b.auto_blocked
                    ? <StatusBadge tone="danger">Auto</StatusBadge>
                    : <StatusBadge tone="neutral">Manual</StatusBadge>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {b.expires_at ? new Date(b.expires_at).toLocaleString() : "Never"}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => unblock(b.id)}>
                    <Unlock className="h-4 w-4 mr-1" /> Unblock
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="h-4 w-4" />
            <div className="font-medium">Active support sessions</div>
            <span className="text-xs text-muted-foreground">Read-only "View Shop" sessions currently open</span>
          </div>
          {supportSessions.length === 0 ? (
            <EmptyState icon={Eye} title="No active sessions" description="No admin is currently in Support View for any shop." />
          ) : (
            <div className="space-y-2">
              {supportSessions.map((s) => (
                <div key={s.id} className="text-xs p-2 rounded border flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{s.tenant_name ?? s.tenant_id}</div>
                    <div className="text-muted-foreground truncate">
                      {adminEmailMap.get(s.admin_id) ?? s.admin_id.slice(0, 8)} · "{s.reason}"
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Started {new Date(s.started_at).toLocaleTimeString()} · Expires {new Date(s.expires_at).toLocaleTimeString()}
                    </div>
                  </div>
                  {isSuperAdmin && (
                    <Button size="sm" variant="outline" onClick={() => endSupportSession(s.id)}>
                      End
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-3">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            <div className="font-medium">Security event log</div>
          </div>
          <div className="flex gap-1 flex-wrap">
            {(["all", "info", "warning", "critical"] as const).map((s) => (
              <Button key={s} size="sm" variant={severity === s ? "default" : "outline"} onClick={() => setSeverity(s)}>
                {s}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => clearEvents(undefined, 7)}>
              Clear old (7d+)
            </Button>
            <Button size="sm" variant="outline" onClick={() => clearEvents("info")}>
              Clear info
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => clearEvents()}>
              Clear all
            </Button>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by event type…"
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
            <Input type="date" value={eventsFrom} onChange={(e) => setEventsFrom(e.target.value)} className="h-9 w-auto" />
            <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
            <Input type="date" value={eventsTo} onChange={(e) => setEventsTo(e.target.value)} className="h-9 w-auto" />
            {(eventTypeFilter || eventsFrom || eventsTo) && (
              <Button size="sm" variant="ghost" onClick={() => { setEventTypeFilter(""); setEventsFrom(""); setEventsTo(""); }}>
                Clear filters
              </Button>
            )}
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Path</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {eventsLoading && (
              <TableRow><TableCell colSpan={7} className="py-4"><TableSkeleton rows={5} columns={7} /></TableCell></TableRow>
            )}
            {!eventsLoading && events.length === 0 && (
              <TableRow><TableCell colSpan={7} className="py-8">
                <EmptyState icon={ShieldCheck} title="No events" description="No security events recorded yet." />
              </TableCell></TableRow>
            )}
            {events.map((e) => {
              const canBlock = !!(e.ip_address || e.email);
              return (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</TableCell>
                  <TableCell>
                    {e.severity === "critical" && <StatusBadge tone="danger">Critical</StatusBadge>}
                    {e.severity === "warning" && <StatusBadge tone="warning">Warning</StatusBadge>}
                    {e.severity === "info" && <StatusBadge tone="neutral">Info</StatusBadge>}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{e.event_type}</TableCell>
                  <TableCell className="font-mono text-xs">{e.ip_address ?? "—"}</TableCell>
                  <TableCell className="text-xs">{e.email ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.path ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {canBlock && (
                      <Button size="sm" variant="outline" onClick={() => blockFromEvent(e)} title="Block this IP/email for 24h">
                        <Lock className="h-4 w-4 mr-1" /> Block
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            <div className="font-medium">Admin audit trail</div>
            <span className="text-xs text-muted-foreground">Recent admin actions</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["admin-audit-logs"] })}>
            Refresh
          </Button>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <Select value={auditActor} onValueChange={setAuditActor}>
            <SelectTrigger className="h-9 w-full sm:w-56"><SelectValue placeholder="All admins" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All admins</SelectItem>
              {adminStaff.map((s) => (
                <SelectItem key={s.user_id} value={s.user_id}>{s.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by action…"
              value={auditAction}
              onChange={(e) => setAuditAction(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
            <Input type="date" value={auditFrom} onChange={(e) => setAuditFrom(e.target.value)} className="h-9 w-auto" />
            <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
            <Input type="date" value={auditTo} onChange={(e) => setAuditTo(e.target.value)} className="h-9 w-auto" />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Changes</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {auditLoading && (
              <TableRow><TableCell colSpan={5} className="py-4"><TableSkeleton rows={5} columns={5} /></TableCell></TableRow>
            )}
            {!auditLoading && auditLogs.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-8">
                <EmptyState icon={ShieldCheck} title="No logs" description="No admin actions logged yet." />
              </TableCell></TableRow>
            )}
            {auditLogs.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</TableCell>
                <TableCell className="text-xs">
                  {l.actor_id
                    ? (adminEmailMap.get(l.actor_id) ?? <span className="font-mono">{l.actor_id.slice(0, 8)}</span>)
                    : "System"}
                </TableCell>
                <TableCell><StatusBadge tone="neutral" className="uppercase text-[10px]">{l.action}</StatusBadge></TableCell>
                <TableCell className="text-xs">
                  {l.tenant_name ? (
                    <div className="font-medium text-primary">{l.tenant_name}</div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  {l.entity_type && <div className="text-[10px] text-muted-foreground">{l.entity_type} {l.entity_id?.slice(0, 8)}</div>}
                </TableCell>
                <TableCell className="text-xs">
                  {l.metadata && Object.keys(l.metadata).length > 0 && (
                    <div className="max-w-xs overflow-hidden">
                       {Object.entries(l.metadata).map(([k, v]) => (
                         <div key={k} className="truncate" title={`${k}: ${JSON.stringify(v)}`}>
                           <span className="font-medium text-[10px] text-muted-foreground mr-1">{k}:</span>
                           <span className="text-[10px]">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                         </div>
                       ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{l.reason ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <BlockDialog open={blockOpen} onClose={() => setBlockOpen(false)} onDone={() => {
        qc.invalidateQueries({ queryKey: ["admin-security-blocks"] });
        qc.invalidateQueries({ queryKey: ["admin-security-summary"] });
      }} />

      <TypedConfirmDialog
        open={clearDialog.open}
        onOpenChange={(open) => setClearDialog(prev => ({ ...prev, open }))}
        title="Clear Security Events"
        description={`Are you sure you want to clear ${
          clearDialog.severity ? clearDialog.severity + " " : ""
        }events${
          clearDialog.olderDays ? " older than " + clearDialog.olderDays + " days" : ""
        }? This will remove them from the log permanently.`}
        confirmLabel="Clear Log"
        requireReason
        destructive
        onConfirm={handleConfirmClear}
      />
    </div>
  );
}


function BlockDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"ip" | "email">("ip");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!value.trim()) return toast.error("Enter a value");
    setBusy(true);
    const { error } = await supabase.rpc("admin_block_identifier", {
      _kind: kind,
      _value: value.trim(),
      _reason: reason.trim() || "Manually blocked by admin",
      _hours: hours ? Number(hours) : undefined,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${kind === "ip" ? "IP" : "Email"} blocked`);
    setValue(""); setReason(""); setHours("");
    onDone();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block IP or email</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant={kind === "ip" ? "default" : "outline"} onClick={() => setKind("ip")}>IP address</Button>
            <Button size="sm" variant={kind === "email" ? "default" : "outline"} onClick={() => setKind("email")}>Email</Button>
          </div>
          <div>
            <div className="text-xs mb-1 text-muted-foreground">{kind === "ip" ? "IP address" : "Email address"}</div>
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "ip" ? "1.2.3.4" : "user@example.com"} />
          </div>
          <div>
            <div className="text-xs mb-1 text-muted-foreground">Reason (audit)</div>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Suspicious activity, brute force, etc." />
          </div>
          <div>
            <div className="text-xs mb-1 text-muted-foreground">Duration (hours, blank = permanent)</div>
            <Input value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9]/g, ""))} placeholder="24" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>
              <Ban className="h-4 w-4 mr-1" /> Block
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Global library moderation
// ─────────────────────────────────────────────────────────────
type LibraryRow = {
  id: string;
  name: string;
  barcode: string | null;
  item_code: string | null;
  category: string | null;
  unit: string | null;
  status: "pending" | "approved" | "rejected";
  default_sell_price: number;
  default_cost_price: number;
  contributed_by_tenant: string | null;
  created_at: string;
};

function LibraryTab() {
  const qc = useQueryClient();
  const { has, isSuperAdmin } = useAdminAccess();
  const canManage = isSuperAdmin || has("library.manage");
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [approveAllOpen, setApproveAllOpen] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, status]);

  const { data: libraryPage, isLoading } = useQuery({
    queryKey: ["admin-library", status, debouncedSearch, page],
    queryFn: async () => {
      let q = supabase
        .from("global_products")
        .select("id, name, barcode, item_code, category, unit, status, default_sell_price, default_cost_price, contributed_by_tenant, created_at", { count: "exact" })
        .order("created_at", { ascending: false });
      if (status !== "all") q = q.eq("status", status);
      if (debouncedSearch) {
        const s = debouncedSearch.replace(/[%,]/g, "");
        q = q.or(`name.ilike.%${s}%,barcode.ilike.%${s}%,item_code.ilike.%${s}%,category.ilike.%${s}%`);
      }
      const { data, error, count } = await q.range(page * pageSize, page * pageSize + pageSize - 1);
      if (error) throw error;
      return { rows: (data as LibraryRow[]) ?? [], total: count ?? 0 };
    },
  });
  const filtered = libraryPage?.rows ?? [];
  const totalFiltered = libraryPage?.total ?? 0;
  const pageStart = totalFiltered === 0 ? 0 : page * pageSize + 1;
  const pageEnd = Math.min((page + 1) * pageSize, totalFiltered);

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["admin-library-pending-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("global_products")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const setRowStatus = async (id: string, next: "approved" | "rejected") => {
    const { error } = await supabase
      .from("global_products")
      .update({ status: next, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(next === "approved" ? "Item approved — fanned out to shops" : "Item rejected");
    qc.invalidateQueries({ queryKey: ["admin-library"] });
    qc.invalidateQueries({ queryKey: ["admin-library-pending-count"] });
  };

  const remove = async (_reason: string) => {
    if (!deleteTarget) return;
    const { error } = await supabase.from("global_products").delete().eq("id", deleteTarget.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["admin-library"] });
    qc.invalidateQueries({ queryKey: ["admin-library-pending-count"] });
  };

  const approveAll = async (_reason: string) => {
    setApprovingAll(true);
    const { error, data } = await supabase
      .from("global_products")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("status", "pending")
      .select("id");
    setApprovingAll(false);
    setApproveAllOpen(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Approved ${data?.length ?? 0} item(s) — fanned out to shops`);
    qc.invalidateQueries({ queryKey: ["admin-library"] });
    qc.invalidateQueries({ queryKey: ["admin-library-pending-count"] });
  };

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-col md:flex-row gap-2 md:items-center mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, barcode, code, category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {(["pending", "approved", "rejected", "all"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={status === f ? "default" : "outline"}
                onClick={() => setStatus(f)}
              >
                {f}{f === "pending" && pendingCount > 0 && status !== "pending" ? ` (${pendingCount})` : ""}
              </Button>
            ))}
            {canManage && pendingCount > 0 && (
              <Button size="sm" variant="outline" onClick={() => setApproveAllOpen(true)}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Approve all ({pendingCount})
              </Button>
            )}
          </div>
        </div>
        {!canManage && (
          <div className="mb-2 text-xs text-muted-foreground">
            Read-only view — ask a super admin to grant the <b>library.manage</b> permission to moderate items.
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Barcode / Code</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Sell</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={7} className="py-4"><TableSkeleton rows={5} columns={7} /></TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="py-8">
                <EmptyState icon={BookOpen} title="Nothing here" description="No library items match the current filter." />
              </TableCell></TableRow>
            )}
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()} · {r.unit ?? "pcs"}</div>
                </TableCell>
                <TableCell className="text-xs font-mono">
                  <div>{r.barcode ?? "—"}</div>
                  <div className="text-muted-foreground">{r.item_code ?? ""}</div>
                </TableCell>
                <TableCell className="text-xs">{r.category ?? "—"}</TableCell>
                <TableCell>
                  {r.status === "pending" && <StatusBadge tone="warning">Pending</StatusBadge>}
                  {r.status === "approved" && <StatusBadge tone="success">Approved</StatusBadge>}
                  {r.status === "rejected" && <StatusBadge tone="danger">Rejected</StatusBadge>}
                </TableCell>
                <TableCell className="text-right">{fmtMoney(r.default_sell_price, "")}</TableCell>
                <TableCell className="text-right">{fmtMoney(r.default_cost_price, "")}</TableCell>
                <TableCell className="text-right">
                  {canManage && (
                    <div className="inline-flex gap-1">
                      {r.status !== "approved" && (
                        <Button size="sm" variant="outline" onClick={() => setRowStatus(r.id, "approved")}>
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                        </Button>
                      )}
                      {r.status !== "rejected" && (
                        <Button size="sm" variant="ghost" onClick={() => setRowStatus(r.id, "rejected")}>
                          <Ban className="h-4 w-4 mr-1 text-destructive" /> Reject
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" title="Delete permanently" onClick={() => setDeleteTarget({ id: r.id, name: r.name })}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2 border-t border-border/40 mt-2">
          <div className="text-xs text-muted-foreground font-medium">
            Showing <span className="text-foreground">{pageStart}</span> to{" "}
            <span className="text-foreground">{pageEnd}</span> of{" "}
            <span className="text-foreground">{totalFiltered}</span> items
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
              Page {page + 1} of {Math.max(1, Math.ceil(totalFiltered / pageSize))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-semibold"
              onClick={() => setPage((p) => p + 1)}
              disabled={pageEnd >= totalFiltered}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      <TypedConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete library item"
        description={`Delete "${deleteTarget?.name}" from the global library? This removes it for every shop that hasn't already imported it.`}
        confirmText={deleteTarget?.name}
        requireReason
        destructive
        confirmLabel="Delete"
        onConfirm={remove}
      />

      <TypedConfirmDialog
        open={approveAllOpen}
        onOpenChange={setApproveAllOpen}
        title="Approve all pending items"
        description={`Approve all ${pendingCount} pending item(s)? Each one will be fanned out into every shop with library access enabled — this cannot be undone in bulk.`}
        confirmLabel="Approve all"
        isLoading={approvingAll}
        onConfirm={approveAll}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Admin staff management (super-admin only)
// ─────────────────────────────────────────────────────────────
type AdminStaffRow = {
  user_id: string;
  email: string;
  created_at: string;
  perms: string[];
};

function AdminStaffTab() {
  const qc = useQueryClient();
  const list = useServerFn(listAdminStaff);
  const add = useServerFn(addAdminStaff);
  const setPerms = useServerFn(setAdminStaffPermissions);
  const remove = useServerFn(removeAdminStaff);

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ["admin-staff"],
    queryFn: async () => ((await list()) as AdminStaffRow[]) ?? [],
  });

  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminStaffRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AdminStaffRow | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-staff"] });

  const removeStaff = async (_reason: string) => {
    if (!removeTarget) return;
    try {
      await remove({ data: { user_id: removeTarget.user_id } });
      toast.success("Removed");
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  };

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <UserCog className="h-4 w-4" />
            <div className="font-medium">Admin staff</div>
            <span className="text-xs text-muted-foreground">Delegate admin panel actions with granular permissions</span>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add staff
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={4} className="py-4"><TableSkeleton rows={3} columns={4} /></TableCell></TableRow>
            )}
            {!isLoading && staff.length === 0 && (
              <TableRow><TableCell colSpan={4} className="py-8">
                <EmptyState icon={UserCog} title="No admin staff yet" description="Add staff to delegate shop approvals, library moderation, and more." />
              </TableCell></TableRow>
            )}
            {staff.map((u) => (
              <TableRow key={u.user_id}>
                <TableCell className="font-medium">{u.email}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.perms.length === 0 && <span className="text-xs text-muted-foreground">No permissions</span>}
                    {u.perms.map((p) => (
                      <span key={p} className="text-[10px] rounded bg-muted px-1.5 py-0.5" title={p}>
                        {ADMIN_PERMS.find((ap) => ap.key === p)?.label ?? p}
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditUser(u)}>Edit</Button>
                    <Button size="icon" variant="ghost" title="Remove" onClick={() => setRemoveTarget(u)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <TypedConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
        title="Remove admin access"
        description={`Remove admin panel access for ${removeTarget?.email}? They will immediately lose all admin permissions.`}
        requireReason
        destructive
        confirmLabel="Remove access"
        onConfirm={removeStaff}
      />

      <AdminStaffDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={async (email, perms) => {
          await add({ data: { email, perms } });
          toast.success("Staff added");
          invalidate();
        }}
      />
      {editUser && (
        <AdminStaffDialog
          open
          initialEmail={editUser.email}
          emailLocked
          initialPerms={editUser.perms}
          onClose={() => setEditUser(null)}
          onSubmit={async (_e, perms) => {
            await setPerms({ data: { user_id: editUser.user_id, perms } });
            toast.success("Permissions updated");
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function AdminStaffDialog({
  open,
  onClose,
  onSubmit,
  initialEmail = "",
  initialPerms = [],
  emailLocked = false,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (email: string, perms: string[]) => Promise<void>;
  initialEmail?: string;
  initialPerms?: string[];
  emailLocked?: boolean;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [perms, setPerms] = useState<Set<string>>(new Set(initialPerms));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(initialEmail);
      setPerms(new Set(initialPerms));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (k: string) => {
    const n = new Set(perms);
    if (n.has(k)) n.delete(k); else n.add(k);
    setPerms(n);
  };

  const submit = async () => {
    if (!email.trim()) return toast.error("Email required");
    setBusy(true);
    try {
      await onSubmit(email.trim(), Array.from(perms));
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{emailLocked ? "Edit admin staff" : "Add admin staff"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Email of an existing Tillix user</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={emailLocked}
              placeholder="staff@example.com"
            />
            {!emailLocked && (
              <p className="text-[11px] text-muted-foreground mt-1">
                The person must already have a Tillix account. Ask them to sign up first, then add them here.
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs">Permissions</Label>
            <div className="space-y-3 mt-1 rounded-md border p-2 max-h-80 overflow-y-auto">
              {Object.entries(
                ADMIN_PERMS.reduce<Record<string, typeof ADMIN_PERMS[number][]>>((acc, p) => {
                  (acc[p.group] ??= []).push(p);
                  return acc;
                }, {}),
              ).map(([group, perms_]) => (
                <div key={group}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{group}</div>
                  <div className="space-y-1.5">
                    {perms_.map((p) => (
                      <label key={p.key} className="flex items-start gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={perms.has(p.key)}
                          onCheckedChange={() => toggle(p.key)}
                          className="mt-0.5"
                        />
                        <div>
                          <div className="font-medium">{p.label}</div>
                          <div className="text-xs text-muted-foreground">{p.description}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Saving…" : emailLocked ? "Save permissions" : "Add staff"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
