import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Wallet, Users, ShoppingCart, Package,
  AlertTriangle, Undo2, ArrowUpRight, ArrowDownRight, Receipt,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { fetchAll } from "@/lib/supabase-page";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Page });

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return startOfDay(d); }

function Page() {
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const since = daysAgo(29).toISOString();

  const { data: sales = [] } = useQuery({
    queryKey: ["dash-sales", since],
    queryFn: async () =>
      (await supabase.from("sales").select("total,cost_total,discount,tax,paid,status,created_at,payment_method")
        .gte("created_at", since)).data ?? [],
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["dash-purchases", since],
    queryFn: async () =>
      (await supabase.from("purchases").select("total,paid,created_at").gte("created_at", since)).data ?? [],
  });
  const { data: saleReturns = [] } = useQuery({
    queryKey: ["dash-sale-returns", since],
    queryFn: async () =>
      (await supabase.from("sale_returns").select("total,refund_amount,created_at").gte("created_at", since)).data ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["dash-products"],
    queryFn: async () =>
      fetchAll<any>((from, to) =>
        supabase
          .from("products")
          .select("id,name,stock,sell_price,cost_price,is_active")
          .eq("is_active", true)
          .range(from, to),
      ),
  });
  const { data: topItemsRaw = [] } = useQuery({
    queryKey: ["dash-top-items", since],
    queryFn: async () =>
      (await supabase.from("sale_items").select("name,qty,line_total,sales!inner(created_at)")
        .gte("sales.created_at", since).limit(2000)).data ?? [],
  });

  const today = startOfDay().getTime();
  const yest = daysAgo(1).getTime();

  const todaySales = sales.filter((s: any) => new Date(s.created_at).getTime() >= today);
  const yestSales = sales.filter((s: any) => {
    const t = new Date(s.created_at).getTime();
    return t >= yest && t < today;
  });

  const sum = (arr: any[], k: string) => arr.reduce((a, x) => a + Number(x[k] ?? 0), 0);
  const revToday = sum(todaySales, "total");
  const revYest = sum(yestSales, "total");
  const profitToday = todaySales.reduce(
    (s: number, x: any) => s + (Number(x.total) - Number(x.tax) - Number(x.cost_total)),
    0,
  );
  const profit30 = sales.reduce(
    (s: number, x: any) => s + (Number(x.total) - Number(x.tax) - Number(x.cost_total)),
    0,
  );
  const rev30 = sum(sales, "total");
  const purch30 = sum(purchases, "total");
  const returns30 = sum(saleReturns, "total");
  const refunds30 = sum(saleReturns, "refund_amount");

  const dayDelta = revYest > 0 ? ((revToday - revYest) / revYest) * 100 : 0;

  // 30-day series
  const series = useMemo(() => {
    const map = new Map<string, { day: string; sales: number; profit: number; returns: number }>();
    for (let i = 29; i >= 0; i--) {
      const d = daysAgo(i);
      const k = d.toISOString().slice(0, 10);
      map.set(k, { day: k.slice(5), sales: 0, profit: 0, returns: 0 });
    }
    sales.forEach((s: any) => {
      const k = new Date(s.created_at).toISOString().slice(0, 10);
      const row = map.get(k);
      if (!row) return;
      row.sales += Number(s.total);
      row.profit += Number(s.total) - Number(s.tax) - Number(s.cost_total);
    });
    saleReturns.forEach((r: any) => {
      const k = new Date(r.created_at).toISOString().slice(0, 10);
      const row = map.get(k);
      if (!row) return;
      row.returns += Number(r.total);
    });
    return Array.from(map.values());
  }, [sales, saleReturns]);

  const methodMix = useMemo(() => {
    const m = new Map<string, number>();
    sales.forEach((s: any) => m.set(s.payment_method, (m.get(s.payment_method) ?? 0) + Number(s.total)));
    return Array.from(m, ([name, value]) => ({ name, value }));
  }, [sales]);
  const pieColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-4)", "var(--chart-5)", "var(--chart-3)"];

  const topItems = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; total: number }>();
    topItemsRaw.forEach((it: any) => {
      const cur = m.get(it.name) ?? { name: it.name, qty: 0, total: 0 };
      cur.qty += Number(it.qty);
      cur.total += Number(it.line_total);
      m.set(it.name, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total).slice(0, 6);
  }, [topItemsRaw]);

  const lowStock = products.filter((p: any) => Number(p.stock) <= 5)
    .sort((a: any, b: any) => Number(a.stock) - Number(b.stock)).slice(0, 6);
  const inventoryValue = products.reduce((s: number, p: any) => s + Number(p.stock) * Number(p.cost_price), 0);

  const [detailKey, setDetailKey] = useState<string | null>(null);

  const detail = useMemo(() => {
    if (!detailKey) return null;
    const fmtDate = (d: string) => new Date(d).toLocaleString();
    const purchToday = purchases.filter((p:any)=>new Date(p.created_at).getTime()>=today);
    const withProfit = (arr: any[]) => arr.map((s:any)=>({...s, profit: Number(s.total)-Number(s.tax)-Number(s.cost_total)}));
    switch (detailKey) {
      case "rev-today":
        return { title: "Today's revenue", cols: ["Date", "Method", "Status", "Total"],
          rows: todaySales.map((s:any)=>[fmtDate(s.created_at), s.payment_method||"-", s.status||"-", fmtMoney(Number(s.total), sym)]),
          total: fmtMoney(revToday, sym) };
      case "profit-today":
        return { title: "Today's profit", cols: ["Date", "Sale total", "Cost", "Tax", "Profit"],
          rows: withProfit(todaySales).map((s:any)=>[fmtDate(s.created_at), fmtMoney(Number(s.total), sym), fmtMoney(Number(s.cost_total), sym), fmtMoney(Number(s.tax), sym), fmtMoney(s.profit, sym)]),
          total: fmtMoney(profitToday, sym) };
      case "purch-30":
        return { title: "Purchases (30 days)", cols: ["Date", "Total", "Paid"],
          rows: purchases.map((p:any)=>[fmtDate(p.created_at), fmtMoney(Number(p.total), sym), fmtMoney(Number(p.paid), sym)]),
          total: fmtMoney(purch30, sym) };
      case "purch-today":
        return { title: "Purchases today", cols: ["Date", "Total", "Paid"],
          rows: purchToday.map((p:any)=>[fmtDate(p.created_at), fmtMoney(Number(p.total), sym), fmtMoney(Number(p.paid), sym)]),
          total: fmtMoney(purchToday.reduce((s:number,p:any)=>s+Number(p.total),0), sym) };
      case "inventory":
        return { title: "Inventory value", cols: ["Product", "Stock", "Cost", "Value"],
          rows: [...products].sort((a:any,b:any)=>Number(b.stock)*Number(b.cost_price)-Number(a.stock)*Number(a.cost_price)).map((p:any)=>[p.name, String(p.stock), fmtMoney(Number(p.cost_price), sym), fmtMoney(Number(p.stock)*Number(p.cost_price), sym)]),
          total: fmtMoney(inventoryValue, sym) };
      case "returns-30":
        return { title: "Returns (30 days)", cols: ["Date", "Total", "Refunded"],
          rows: saleReturns.map((r:any)=>[fmtDate(r.created_at), fmtMoney(Number(r.total), sym), fmtMoney(Number(r.refund_amount), sym)]),
          total: fmtMoney(returns30, sym) };
      case "rev-30":
        return { title: "Revenue (30 days)", cols: ["Date", "Method", "Total"],
          rows: sales.map((s:any)=>[fmtDate(s.created_at), s.payment_method||"-", fmtMoney(Number(s.total), sym)]),
          total: fmtMoney(rev30, sym) };
      case "profit-30":
        return { title: "Profit (30 days)", cols: ["Date", "Sale total", "Cost", "Tax", "Profit"],
          rows: withProfit(sales).map((s:any)=>[fmtDate(s.created_at), fmtMoney(Number(s.total), sym), fmtMoney(Number(s.cost_total), sym), fmtMoney(Number(s.tax), sym), fmtMoney(s.profit, sym)]),
          total: fmtMoney(profit30, sym) };
      case "invoices-30":
        return { title: "Invoices (30 days)", cols: ["Date", "Method", "Status", "Total", "Paid"],
          rows: sales.map((s:any)=>[fmtDate(s.created_at), s.payment_method||"-", s.status||"-", fmtMoney(Number(s.total), sym), fmtMoney(Number(s.paid), sym)]),
          total: `${sales.length} invoices` };
    }
    return null;
  }, [detailKey, sales, purchases, saleReturns, products, todaySales, revToday, profitToday, purch30, returns30, refunds30, rev30, profit30, inventoryValue, sym, today]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Overview of the last 30 days · ${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}`}
        icon={<TrendingUp className="h-5 w-5" />}
        actions={
          <>
            <Button asChild><Link to="/pos"><ShoppingCart className="h-4 w-4 mr-2" />Open POS</Link></Button>
            <Button asChild variant="outline"><Link to="/reports"><Receipt className="h-4 w-4 mr-2" />Reports</Link></Button>
          </>
        }
      />


      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi onClick={() => setDetailKey("rev-today")}
          icon={TrendingUp} label="Today's revenue" value={fmtMoney(revToday, sym)}
          delta={dayDelta} sub={`${todaySales.length} invoices`} tone="primary"
        />
        <Kpi onClick={() => setDetailKey("profit-today")}
          icon={Wallet} label="Today's profit" value={fmtMoney(profitToday, sym)}
          sub="After cost & tax" tone="success"
        />
        <Kpi onClick={() => setDetailKey("purch-30")}
          icon={TrendingDown} label="Purchases (30d)" value={fmtMoney(purch30, sym)}
          sub={`${fmtMoney(purchases.filter((p:any)=>new Date(p.created_at).getTime()>=today).reduce((s:number,p:any)=>s+Number(p.total),0), sym)} today`} tone="warning"
        />
        <Kpi onClick={() => setDetailKey("inventory")}
          icon={Package} label="Inventory value" value={fmtMoney(inventoryValue, sym)}
          sub={`${products.length} active SKUs`} tone="info"
        />
        <Kpi onClick={() => setDetailKey("returns-30")}
          icon={Undo2} label="Returns (30d)" value={fmtMoney(returns30, sym)}
          sub={`${fmtMoney(refunds30, sym)} refunded`} tone="warning"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-semibold">Revenue & profit</h2>
              <p className="text-xs text-muted-foreground">Last 30 days</p>
            </div>
            <div className="flex gap-3 text-xs text-muted-foreground">
              <Legend2 color="var(--chart-1)" label="Sales" />
              <Legend2 color="var(--chart-2)" label="Profit" />
              <Legend2 color="var(--chart-3)" label="Returns" />
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="gs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={48} />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)", border: "1px solid var(--border)",
                    borderRadius: 8, fontSize: 12,
                  }}
                  formatter={(v: any) => fmtMoney(Number(v), sym)}
                />
                <Area type="monotone" dataKey="sales" stroke="var(--chart-1)" fill="url(#gs)" strokeWidth={2} />
                <Area type="monotone" dataKey="profit" stroke="var(--chart-2)" fill="url(#gp)" strokeWidth={2} />
                <Area type="monotone" dataKey="returns" stroke="var(--chart-3)" fill="transparent" strokeWidth={1.5} strokeDasharray="4 3" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Payment mix</h2>
          <p className="text-xs text-muted-foreground mb-2">By revenue (30d)</p>
          <div className="h-64">
            {methodMix.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={methodMix} dataKey="value" nameKey="name" innerRadius={50} outerRadius={88} paddingAngle={2}>
                    {methodMix.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
                  </Pie>
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)", border: "1px solid var(--border)",
                      borderRadius: 8, fontSize: 12,
                    }}
                    formatter={(v: any) => fmtMoney(Number(v), sym)}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-semibold">Top selling items</h2>
              <p className="text-xs text-muted-foreground">Last 30 days</p>
            </div>
          </div>
          <div className="h-64">
            {topItems.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No sales yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topItems} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)", border: "1px solid var(--border)",
                      borderRadius: 8, fontSize: 12,
                    }}
                    formatter={(v: any) => fmtMoney(Number(v), sym)}
                  />
                  <Bar dataKey="total" fill="var(--chart-1)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Low stock
              </h2>
              <p className="text-xs text-muted-foreground">≤ 5 units in hand</p>
            </div>
            <Button asChild size="sm" variant="ghost"><Link to="/products">View all</Link></Button>
          </div>
          <div className="space-y-2">
            {lowStock.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">Stock looks healthy ✓</div>
            ) : lowStock.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between border-b last:border-0 pb-2 last:pb-0">
                <div className="text-sm truncate pr-2">{p.name}</div>
                <StatusBadge tone={Number(p.stock) === 0 ? "danger" : "warning"}>
                  {Number(p.stock)} left
                </StatusBadge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Period summary footer */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Mini label="Revenue 30d" value={fmtMoney(rev30, sym)} icon={TrendingUp} />
        <Mini label="Profit 30d" value={fmtMoney(profit30, sym)} icon={Wallet} accent />
        <Mini label="Purchases today" value={fmtMoney(purchases.filter((p:any)=>new Date(p.created_at).getTime()>=today).reduce((s:number,p:any)=>s+Number(p.total),0), sym)} icon={TrendingDown} accent />
        <Mini label="Purchases 30d" value={fmtMoney(purch30, sym)} icon={TrendingDown} />
        <Mini label="Invoices 30d" value={String(sales.length)} icon={Users} />
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, delta, sub, tone,
}: { icon: any; label: string; value: string; delta?: number; sub?: string; tone: string }) {
  const ring: Record<string, string> = {
    primary: "from-primary/15 to-primary/0 text-primary",
    success: "from-success/15 to-success/0 text-success",
    warning: "from-warning/20 to-warning/0 text-accent-foreground",
    info: "from-chart-5/20 to-chart-5/0 text-foreground",
  };
  return (
    <Card className="p-5 relative overflow-hidden">
      <div className={`absolute inset-0 bg-gradient-to-br ${ring[tone]} pointer-events-none`} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
          <div className={`h-8 w-8 rounded-md bg-background/60 backdrop-blur flex items-center justify-center ${ring[tone].split(" ").pop()}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="text-3xl font-bold mt-2">{value}</div>
        <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
          <span>{sub}</span>
          {delta !== undefined && delta !== 0 && (
            <span className={`flex items-center gap-0.5 font-medium ${delta >= 0 ? "text-success" : "text-destructive"}`}>
              {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function Mini({ label, value, icon: Icon, accent }: { label: string; value: string; icon: any; accent?: boolean }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`h-9 w-9 rounded-md flex items-center justify-center ${accent ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold">{value}</div>
      </div>
    </Card>
  );
}

function Legend2({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
