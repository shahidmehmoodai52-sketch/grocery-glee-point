import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Eye,
  LogOut,
  Package,
  Users,
  ShoppingCart,
  Wallet,
  ScrollText,
  Activity,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard } from "@/components/ui/stat-card";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { fmtMoney } from "@/lib/format";

export const Route = createFileRoute("/admin_/support/$sessionId")({
  beforeLoad: async ({ location }) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw redirect({ to: "/admin-login", search: { next: location.pathname } });
    }
    const { data: isAdmin } = await supabase.rpc("am_i_admin_staff");
    if (!isAdmin) {
      await supabase.auth.signOut();
      throw redirect({ to: "/admin-login" });
    }
  },
  component: SupportViewPage,
});

interface SupportSession {
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
}

interface TenantDetail {
  tenant: {
    id: string;
    name: string;
    slug: string | null;
    status: string;
    created_at: string;
    owner_id: string | null;
    library_approved: boolean;
  };
  stats: { products: number; customers: number; sales_count: number; sales_total: number };
  members: { user_id: string; email: string | null; full_name: string | null; role: string }[];
}

function SupportViewPage() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [now, setNow] = useState(() => Date.now());

  const {
    data: session,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["admin-support-session", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_support_sessions_view")
        .select("*")
        .eq("id", sessionId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as SupportSession | null;
    },
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = session
    ? Math.max(0, Math.floor((new Date(session.expires_at).getTime() - now) / 1000))
    : 0;
  const expired = !session || !session.is_active || secondsLeft <= 0;

  // Auto-exit: end the session server-side the moment the countdown hits
  // zero, then bounce back to the admin panel. The RPC itself derives
  // "auto_expired" vs "manual_exit" from the server clock, not from why the
  // client called it.
  useEffect(() => {
    if (!session || !session.is_active) return;
    if (secondsLeft > 0) return;
    (async () => {
      await supabase.rpc("admin_end_support_session", { _session_id: sessionId });
      refetch();
    })();
  }, [secondsLeft, session, sessionId, refetch]);

  const exit = async () => {
    await supabase.rpc("admin_end_support_session", { _session_id: sessionId });
    navigate({ to: "/admin/shops/$id", params: { id: session?.tenant_id ?? "" } });
  };

  const { data: detail } = useQuery({
    queryKey: ["admin-tenant-detail", session?.tenant_id],
    enabled: !!session?.tenant_id && !expired,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_tenant_detail", {
        _tenant_id: session!.tenant_id,
      });
      if (error) throw error;
      return data as unknown as TenantDetail;
    },
  });

  const { data: audit = [] } = useQuery({
    queryKey: ["admin-tenant-audit", session?.tenant_id],
    enabled: !!session?.tenant_id && !expired,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_tenant_audit", {
        _tenant_id: session!.tenant_id,
        _limit: 50,
      });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const mmss = useMemo(() => {
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, [secondsLeft]);

  if (isLoading)
    return (
      <div className="p-6">
        <TableSkeleton rows={6} columns={4} />
      </div>
    );

  if (expired) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card className="p-6 text-center space-y-3">
          <Eye className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="font-medium">Support View session ended</div>
          <p className="text-sm text-muted-foreground">
            {session
              ? `This session for "${session.tenant_name}" has ended (${session.ended_reason ?? "expired"}).`
              : "This session could not be found."}
          </p>
          <Button asChild variant="outline">
            <Link to="/admin">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Panel
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  const owner = detail?.members.find((m) => m.user_id === detail.tenant.owner_id) ?? null;

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="sticky top-0 z-50 bg-destructive text-destructive-foreground px-4 py-3 shadow-md">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Eye className="h-5 w-5 shrink-0" />
            <div>
              <div className="font-bold text-sm tracking-wide">SUPPORT VIEW — READ ONLY</div>
              <div className="text-xs opacity-90">
                {user?.email ?? "Admin"} viewing <b>{session!.tenant_name}</b> · Reason: "
                {session!.reason}"
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono bg-destructive-foreground/15 rounded px-2 py-1">
              Expires in {mmss}
            </span>
            <Button size="sm" variant="secondary" onClick={exit}>
              <LogOut className="h-4 w-4 mr-1" /> Exit
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-4">
        {!detail ? (
          <TableSkeleton rows={4} columns={4} />
        ) : (
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">
                <Eye className="h-4 w-4 mr-1" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="activity">
                <ScrollText className="h-4 w-4 mr-1" />
                Activity
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-3 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Products" value={detail.stats.products} icon={Package} />
                <StatCard label="Customers" value={detail.stats.customers} icon={Users} />
                <StatCard label="Sales" value={detail.stats.sales_count} icon={ShoppingCart} />
                <StatCard
                  label="Revenue"
                  value={fmtMoney(detail.stats.sales_total, "")}
                  icon={Wallet}
                />
              </div>
              <Card className="p-4 space-y-2">
                <div className="text-sm font-medium">Shop details</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Shop name: </span>
                    {detail.tenant.name}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status: </span>
                    <StatusBadge status={detail.tenant.status} />
                  </div>
                  <div>
                    <span className="text-muted-foreground">Owner: </span>
                    {owner?.full_name ?? owner?.email ?? "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Owner email: </span>
                    {owner?.email ?? "—"}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground pt-2 border-t">
                  This is a read-only summary. No sales, inventory, staff, or settings changes can
                  be made from Support View.
                </p>
              </Card>
            </TabsContent>

            <TabsContent value="activity" className="mt-3">
              <Card className="p-3">
                <div className="text-sm font-medium mb-2 flex items-center gap-1">
                  <Activity className="h-4 w-4" /> Recent activity (last 50)
                </div>
                {audit.length === 0 ? (
                  <EmptyState
                    icon={Activity}
                    title="No activity"
                    description="No audit log entries yet."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Table</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {audit.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(a.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              tone={
                                a.action === "DELETE"
                                  ? "danger"
                                  : a.action === "INSERT"
                                    ? "success"
                                    : "neutral"
                              }
                            >
                              {a.action}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="text-[10px] font-mono">{a.table_name}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
