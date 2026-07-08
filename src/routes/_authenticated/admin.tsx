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
  ShieldAlert,
  Lock,
  Unlock,
  AlertTriangle,
  Plus,
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
          <TabsTrigger value="security"><ShieldAlert className="h-4 w-4 mr-1" />Security</TabsTrigger>
          <TabsTrigger value="errors"><Bug className="h-4 w-4 mr-1" />Errors</TabsTrigger>
        </TabsList>
        <TabsContent value="tenants" className="mt-3"><TenantsTab /></TabsContent>
        <TabsContent value="security" className="mt-3"><SecurityTab /></TabsContent>
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
      _tenant_id: id, _status: status, _reason: reason ?? undefined,
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

type SecuritySummary = {
  failed_logins_24h: number;
  critical_24h: number;
  total_24h: number;
  active_blocks: number;
  unique_ips_24h: number;
};

function SecurityTab() {
  const qc = useQueryClient();
  const [severity, setSeverity] = useState<"all" | "info" | "warning" | "critical">("all");
  const [blockOpen, setBlockOpen] = useState(false);

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

  const unblock = async (id: string) => {
    const { error } = await supabase.rpc("admin_unblock_identifier", { _id: id });
    if (error) return toast.error(error.message);
    toast.success("Unblocked");
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {eventsLoading && (
              <TableRow><TableCell colSpan={6} className="py-4"><TableSkeleton rows={5} columns={6} /></TableCell></TableRow>
            )}
            {!eventsLoading && events.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8">
                <EmptyState icon={ShieldCheck} title="No events" description="No security events recorded yet." />
              </TableCell></TableRow>
            )}
            {events.map((e) => (
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <BlockDialog open={blockOpen} onClose={() => setBlockOpen(false)} onDone={() => {
        qc.invalidateQueries({ queryKey: ["admin-security-blocks"] });
        qc.invalidateQueries({ queryKey: ["admin-security-summary"] });
      }} />
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
