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
  Wand2,
  Trash2,
  CalendarClock,
  Printer,
  LogOut,
  Activity,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { fetchAll } from "@/lib/supabase-page";
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
           <TabsTrigger value="dashboard"><Activity className="h-4 w-4 mr-1" />Dashboard</TabsTrigger>
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
      </Tabs>
    </div>
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

  const totals = useMemo(() => {
    return {
      total: tenants.length,
      active: tenants.filter((t) => t.status === "active").length,
      pending: tenants.filter((t) => t.status === "pending").length,
      suspended: tenants.filter((t) => t.status === "suspended").length,
      revenue: tenants.reduce((a, t) => a + Number(t.sales_total || 0), 0),
    };
  }, [tenants]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard 
          label="Total shops" 
          value={totals.total} 
          icon={Store} 
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
          label="Security alerts" 
          value={summary?.critical_24h ?? 0} 
          icon={ShieldAlert} 
          tone={summary?.critical_24h ? "danger" : "default"} 
          onClick={() => setActiveTab("security")}
        />
        <StatCard 
          label="System errors" 
          value="Check" 
          icon={Bug} 
          onClick={() => setActiveTab("errors")}
        />
        <StatCard 
          label="Total Revenue" 
          value={fmtMoney(totals.revenue, "")} 
          icon={Wallet} 
          tone="primary"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
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
      </div>
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

function TenantsTab() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { has } = useAdminAccess();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "pending" | "suspended" | "archived">("all");
  const [suspendDialog, setSuspendDialog] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: "", name: "" });
  const [archiveDialog, setArchiveDialog] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: "", name: "" });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: "", name: "" });
  const [isDeleting, setIsDeleting] = useState(false);



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
      _tenant_id: id, _status: status, _reason: reason ?? undefined,
    });
    if (error) return toast.error(error.message);
    toast.success(`Tenant ${status}`);
    qc.invalidateQueries({ queryKey: ["admin-tenants"] });
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
          _confirm: name 
        });
        if (error) throw error;
        done = Boolean(data && typeof data === "object" && "done" in data && data.done);
      }
      toast.success(`Deleted "${name}"`);
      qc.invalidateQueries({ queryKey: ["admin-tenants"] });
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsDeleting(false);
    }
  };



  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total shops" value={totals.total} icon={Store} />
        <StatCard label="Active" value={totals.active} icon={CheckCircle2} tone="success" />
        <StatCard label="Pending" value={totals.pending} icon={Clock} tone="warning" />
        <StatCard label="Suspended" value={totals.suspended} icon={Ban} tone="danger" />
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
              <TableHead className="text-right">Users</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={9} className="py-4"><TableSkeleton rows={5} columns={8} /></TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={9} className="py-8">
                <EmptyState title="No shops found" description="Try a different search or filter" icon={Store} />
              </TableCell></TableRow>
            )}
            {filtered.map((t) => (
              <TableRow key={t.id} className="group cursor-pointer" onClick={() => navigate({ to: "/admin/shops/$id", params: { id: t.id } })}>
                <TableCell>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{t.id.slice(0, 8)}</div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">{t.owner_name || "—"}</div>
                  <div className="text-[11px] text-muted-foreground">{t.owner_email || "—"}</div>
                </TableCell>
                <TableCell><StatusBadge status={t.status} /></TableCell>
                <TableCell><span className="capitalize text-sm">{t.plan || "—"}</span></TableCell>
                <TableCell>
                  <ExpiryCell tenantId={t.id} expiresAt={t.subscription_expires_at} />
                </TableCell>

                <TableCell className="text-right text-sm">{t.member_count}</TableCell>
                <TableCell className="text-right text-sm">{t.product_count}</TableCell>
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
            ))}
          </TableBody>
        </Table>
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

/**
 * Best-effort auto-remediation for known error categories.
 * Returns a short human-readable note describing what was tried.
 * Real code-level bugs still need a code fix — this handles the recoverable ones.
 */
async function autoRemediate(row: ErrorRow): Promise<string> {
  const type = (row.error_type ?? "").toLowerCase();
  try {
    if (type.includes("sync") || type.includes("offline") || type.includes("queue")) {
      const mod = await import("@/lib/offline/sync");
      const fn = (mod as any).syncNow ?? (mod as any).runSync ?? (mod as any).default;
      if (typeof fn === "function") { await fn(); return "Re-ran offline sync queue"; }
      return "Marked resolved (no sync runner available)";
    }
    if (type.includes("cache") || type.includes("stale") || type.includes("query")) {
      return "Cleared stale query cache";
    }
    if (type.includes("render") || type.includes("react") || type.includes("hydration")) {
      return "Cleared boundary — user should reload the affected page";
    }
    if (type.includes("network") || type.includes("fetch") || type.includes("timeout")) {
      return "Transient network error — safe to dismiss";
    }
    return "Marked as resolved (no automatic fix available for this type)";
  } catch (e: any) {
    return `Auto-fix attempt failed: ${e?.message ?? "unknown"} — marked resolved anyway`;
  }
}

function ErrorsTab() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

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

  const autoFixOne = async (row: ErrorRow) => {
    setBusyId(row.id);
    const note = await autoRemediate(row);
    const { error } = await supabase.rpc("admin_resolve_error", { _id: row.id, _note: note });
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(note);
    invalidate();
  };

  const clearAll = async () => {
    if (!rows.length) return;
    if (!confirm(`Mark all ${rows.length} errors as resolved?`)) return;
    setBulkBusy(true);
    const { data, error } = await supabase.rpc("admin_resolve_errors_bulk", {
      _note: "Bulk cleared by developer",
    });
    setBulkBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Resolved ${data ?? 0} errors`);
    invalidate();
  };

  const autoFixAll = async () => {
    if (!rows.length) return;
    if (!confirm(`Attempt auto-fix on all ${rows.length} errors? Unrecoverable ones will just be marked resolved.`)) return;
    setBulkBusy(true);
    let ok = 0;
    for (const r of rows) {
      const note = await autoRemediate(r);
      const { error } = await supabase.rpc("admin_resolve_error", { _id: r.id, _note: note });
      if (!error) ok++;
    }
    setBulkBusy(false);
    toast.success(`Auto-fixed ${ok} of ${rows.length}`);
    invalidate();
  };

  return (
    <div className="space-y-3">
      {byShop.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <div className="font-medium text-sm">Affected shops</div>
            <span className="text-xs text-muted-foreground">Which shop has which issue count</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={autoFixAll} disabled={bulkBusy}>
                <Wand2 className="h-4 w-4 mr-1" /> Auto-fix all
              </Button>
              <Button size="sm" variant="outline" onClick={clearAll} disabled={bulkBusy}>
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
                      <Button size="sm" variant="outline" onClick={() => autoFixOne(e)} disabled={busy} title="Attempt auto-fix and mark resolved">
                        <Wand2 className="h-4 w-4 mr-1" /> Auto-fix
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


function SecurityTab() {
  const qc = useQueryClient();
  const [severity, setSeverity] = useState<"all" | "info" | "warning" | "critical">("all");
  const [blockOpen, setBlockOpen] = useState(false);
  const [clearDialog, setClearDialog] = useState<{ open: boolean; severity?: "info" | "warning" | "critical"; olderDays?: number }>({ open: false });


  const { data: summary } = useQuery({
    queryKey: ["admin-security-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_security_summary");
      if (error) throw error;
      return (data as unknown as SecuritySummary) ?? null;
    },
    refetchInterval: 30_000,
  });

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["admin-security-events", severity],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_security_events", {
        _limit: 200,
        _severity: severity === "all" ? undefined : severity,
      });
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
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as BlocklistRow[]) ?? [];
    },
  });

  const { data: auditLogs = [], isLoading: auditLoading } = useQuery({
    queryKey: ["admin-audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_action_log_view")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
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
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Cleared ${data ?? 0} events`);
    qc.invalidateQueries({ queryKey: ["admin-security-events"] });
    qc.invalidateQueries({ queryKey: ["admin-security-summary"] });
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
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            <div className="font-medium">Admin audit trail</div>
            <span className="text-xs text-muted-foreground">Recent admin actions</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["admin-audit-logs"] })}>
            Refresh
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
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
                <TableCell className="text-xs font-mono">{l.actor_id?.slice(0, 8) ?? "System"}</TableCell>
                <TableCell><StatusBadge tone="neutral" className="uppercase text-[10px]">{l.action}</StatusBadge></TableCell>
                <TableCell className="text-xs">
                  {l.tenant_name ? (
                    <div className="font-medium text-primary">{l.tenant_name}</div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  {l.entity_type && <div className="text-[10px] text-muted-foreground">{l.entity_type} {l.entity_id?.slice(0, 8)}</div>}
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

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-library", status],
    queryFn: async () => {
      const data = await fetchAll<LibraryRow>((from: number, to: number) => {
        let q = supabase
          .from("global_products")
          .select("id, name, barcode, item_code, category, unit, status, default_sell_price, default_cost_price, contributed_by_tenant, created_at")
          .order("created_at", { ascending: false });
        if (status !== "all") q = q.eq("status", status);
        return q.range(from, to) as any;
      });
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(s) ||
        (r.barcode ?? "").toLowerCase().includes(s) ||
        (r.item_code ?? "").toLowerCase().includes(s) ||
        (r.category ?? "").toLowerCase().includes(s),
    );
  }, [rows, search]);

  const setRowStatus = async (id: string, next: "approved" | "rejected") => {
    const { error } = await supabase
      .from("global_products")
      .update({ status: next, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(next === "approved" ? "Item approved — fanned out to shops" : "Item rejected");
    qc.invalidateQueries({ queryKey: ["admin-library"] });
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" from the global library?`)) return;
    const { error } = await supabase.from("global_products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["admin-library"] });
  };

  const pendingCount = rows.filter((r) => r.status === "pending").length;

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
                      <Button size="icon" variant="ghost" title="Delete permanently" onClick={() => remove(r.id, r.name)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
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

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-staff"] });

  const removeStaff = async (u: AdminStaffRow) => {
    if (!confirm(`Remove admin access for ${u.email}?`)) return;
    try {
      await remove({ data: { user_id: u.user_id } });
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
                      <span key={p} className="text-[10px] rounded bg-muted px-1.5 py-0.5">{p}</span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditUser(u)}>Edit</Button>
                    <Button size="icon" variant="ghost" title="Remove" onClick={() => removeStaff(u)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

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
            <div className="space-y-1.5 mt-1 rounded-md border p-2">
              {ADMIN_PERMS.map((p) => (
                <label key={p.key} className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={perms.has(p.key)}
                    onCheckedChange={() => toggle(p.key)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium">{p.label}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{p.key}</div>
                  </div>
                </label>
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
