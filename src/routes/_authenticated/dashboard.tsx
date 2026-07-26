import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Wallet, Users, ShoppingCart, Package,
  AlertTriangle, Undo2, ArrowUpRight, ArrowDownRight, Receipt, CalendarIcon,
} from "lucide-react";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { fetchAll } from "@/lib/supabase-page";
import { PRESETS, rangeFor, type DatePreset } from "@/lib/date-presets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Page });

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function diffDays(a: Date, b: Date) {
  return Math.max(1, Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000) + 1);
}

function Page() {
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";

  const [preset, setPreset] = useState<DatePreset | "custom">("today");
  const [from, setFrom] = useState<Date>(startOfDay(new Date()));
  const [to, setTo] = useState<Date>(startOfDay(new Date()));

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    const r = rangeFor(p);
    if (p === "all") {
      const now = new Date();
      setFrom(new Date(2000, 0, 1));
      setTo(startOfDay(now));
    } else {
      setFrom(startOfDay(new Date(r.from)));
      setTo(startOfDay(new Date(r.to)));
    }
  };

  const fromISO = startOfDay(from).toISOString();
  const toISO = endOfDay(to).toISOString();
  const spanDays = diffDays(from, to);

  // Previous period for comparison
  const prevTo = new Date(startOfDay(from).getTime() - 1);
  const prevFrom = new Date(startOfDay(prevTo).getTime() - (spanDays - 1) * 86400000);
  const prevFromISO = startOfDay(prevFrom).toISOString();
  const prevToISO = endOfDay(prevTo).toISOString();

  const { data: sales = [] } = useQuery({
    queryKey: ["dash-sales", fromISO, toISO],
    queryFn: async () =>
      (await supabase.from("sales").select("total,cost_total,discount,tax,paid,status,created_at,payment_method")
        .gte("created_at", fromISO).lte("created_at", toISO)).data ?? [],
  });
  const { data: prevSales = [] } = useQuery({
    queryKey: ["dash-sales-prev", prevFromISO, prevToISO],
    queryFn: async () =>
      (await supabase.from("sales").select("total,created_at")
        .gte("created_at", prevFromISO).lte("created_at", prevToISO)).data ?? [],
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["dash-purchases", fromISO, toISO],
    queryFn: async () =>
      (await supabase.from("purchases").select("total,paid,created_at")
        .gte("created_at", fromISO).lte("created_at", toISO)).data ?? [],
  });
  const { data: saleReturns = [] } = useQuery({
    queryKey: ["dash-sale-returns", fromISO, toISO],
    queryFn: async () =>
      (await supabase.from("sale_returns").select("total,subtotal,refund_amount,created_at,sale_return_items(qty,cost)")
        .gte("created_at", fromISO).lte("created_at", toISO)).data ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["dash-products"],
    queryFn: async () =>
      fetchAll<any>((f, t) =>
        supabase
          .from("products")
          .select("id,name,stock,sell_price,cost_price,is_active")
          .eq("is_active", true)
          .range(f, t),
      ),
  });
  const { data: topItemsRaw = [] } = useQuery({
    queryKey: ["dash-top-items", fromISO, toISO],
    queryFn: async () =>
      (await supabase.from("sale_items").select("name,qty,line_total,sales!inner(created_at)")
        .gte("sales.created_at", fromISO).lte("sales.created_at", toISO).limit(2000)).data ?? [],
  });

  const sum = (arr: any[], k: string) => arr.reduce((a, x) => a + Number(x[k] ?? 0), 0);
  const revenue = sum(sales, "total");
  const prevRevenue = sum(prevSales, "total");
  const salesProfit = sales.reduce(
    (s: number, x: any) => s + (Number(x.total) - Number(x.tax) - Number(x.cost_total)),
    0,
  );
  const purchTotal = sum(purchases, "total");
  const returnsTotal = sum(saleReturns, "total");
  const refundsTotal = sum(saleReturns, "refund_amount");
  const returnsProfit = saleReturns.reduce((s: number, r: any) => {
    const items = r.sale_return_items ?? [];
    const itemsCost = items.reduce((c: number, it: any) => c + Number(it.cost ?? 0) * Number(it.qty ?? 0), 0);
    return s + (Number(r.subtotal ?? r.total) - itemsCost);
  }, 0);
  const netRevenue = revenue - returnsTotal;
  const profit = salesProfit - returnsProfit;

  const delta = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;

  // Time series over selected range. For a single day, bucket by hour so the chart has multiple points.
  const series = useMemo(() => {
    const map = new Map<string, { day: string; sales: number; profit: number; returns: number }>();
    const hourly = spanDays <= 1;
    if (hourly) {
      const base = startOfDay(from).getTime();
      for (let h = 0; h < 24; h++) {
        const k = `H${h}`;
        map.set(k, { day: `${String(h).padStart(2, "0")}:00`, sales: 0, profit: 0, returns: 0 });
      }
      const bucketOf = (iso: string) => {
        const t = new Date(iso).getTime();
        const h = Math.floor((t - base) / 3600000);
        return h >= 0 && h < 24 ? `H${h}` : null;
      };
      sales.forEach((s: any) => {
        const k = bucketOf(s.created_at); if (!k) return;
        const row = map.get(k)!;
        row.sales += Number(s.total);
        row.profit += Number(s.total) - Number(s.tax) - Number(s.cost_total);
      });
      saleReturns.forEach((r: any) => {
        const k = bucketOf(r.created_at); if (!k) return;
        map.get(k)!.returns += Number(r.total);
      });
    } else {
      for (let i = 0; i < Math.min(spanDays, 180); i++) {
        const d = new Date(startOfDay(from).getTime() + i * 86400000);
        const k = d.toISOString().slice(0, 10);
        map.set(k, { day: k.slice(5), sales: 0, profit: 0, returns: 0 });
      }
      sales.forEach((s: any) => {
        const k = new Date(s.created_at).toISOString().slice(0, 10);
        const row = map.get(k); if (!row) return;
        row.sales += Number(s.total);
        row.profit += Number(s.total) - Number(s.tax) - Number(s.cost_total);
      });
      saleReturns.forEach((r: any) => {
        const k = new Date(r.created_at).toISOString().slice(0, 10);
        const row = map.get(k); if (!row) return;
        row.returns += Number(r.total);
      });
    }
    return Array.from(map.values());
  }, [sales, saleReturns, from, spanDays]);

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

  const rangeLabel = preset === "custom"
    ? `${format(from, "MMM d")} – ${format(to, "MMM d, yyyy")}`
    : (PRESETS.find(p => p.key === preset)?.label ?? "Today");

  const detail = useMemo(() => {
    if (!detailKey) return null;
    const fmtDate = (d: string) => new Date(d).toLocaleString();
    const withProfit = (arr: any[]) => arr.map((s:any)=>({...s, profit: Number(s.total)-Number(s.tax)-Number(s.cost_total)}));
    switch (detailKey) {
      case "revenue":
        return { title: `Revenue · ${rangeLabel}`, cols: ["Date", "Method", "Status", "Total"],
          rows: sales.map((s:any)=>[fmtDate(s.created_at), s.payment_method||"-", s.status||"-", fmtMoney(Number(s.total), sym)]),
          total: fmtMoney(revenue, sym) };
      case "profit":
        return { title: `Profit · ${rangeLabel}`, cols: ["Metric", "Amount"],
          rows: [["Sales profit (total − cost − tax)", fmtMoney(salesProfit, sym)], ["Returns profit reversed", `- ${fmtMoney(returnsProfit, sym)}`], ["Net profit", fmtMoney(profit, sym)]],
          total: fmtMoney(profit, sym) };
      case "purch":
        return { title: `Purchases · ${rangeLabel}`, cols: ["Date", "Total", "Paid"],
          rows: purchases.map((p:any)=>[fmtDate(p.created_at), fmtMoney(Number(p.total), sym), fmtMoney(Number(p.paid), sym)]),
          total: fmtMoney(purchTotal, sym) };
      case "inventory":
        return { title: "Inventory value", cols: ["Product", "Stock", "Cost", "Value"],
          rows: [...products].sort((a:any,b:any)=>Number(b.stock)*Number(b.cost_price)-Number(a.stock)*Number(a.cost_price)).map((p:any)=>[p.name, String(p.stock), fmtMoney(Number(p.cost_price), sym), fmtMoney(Number(p.stock)*Number(p.cost_price), sym)]),
          total: fmtMoney(inventoryValue, sym) };
      case "returns":
        return { title: `Returns · ${rangeLabel}`, cols: ["Date", "Total", "Refunded"],
          rows: saleReturns.map((r:any)=>[fmtDate(r.created_at), fmtMoney(Number(r.total), sym), fmtMoney(Number(r.refund_amount), sym)]),
          total: fmtMoney(returnsTotal, sym) };
      case "invoices":
        return { title: `Invoices · ${rangeLabel}`, cols: ["Date", "Method", "Status", "Total", "Paid"],
          rows: sales.map((s:any)=>[fmtDate(s.created_at), s.payment_method||"-", s.status||"-", fmtMoney(Number(s.total), sym), fmtMoney(Number(s.paid), sym)]),
          total: `${sales.length} invoices` };
      case "net":
        return { title: `Net revenue · ${rangeLabel}`, cols: ["Metric", "Amount"],
          rows: [["Revenue", fmtMoney(revenue, sym)], ["Returns", `- ${fmtMoney(returnsTotal, sym)}`], ["Net", fmtMoney(netRevenue, sym)]],
          total: fmtMoney(netRevenue, sym) };
    }
    return null;
  }, [detailKey, sales, purchases, saleReturns, products, revenue, profit, purchTotal, returnsTotal, refundsTotal, netRevenue, inventoryValue, sym, rangeLabel]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Dashboard"
        description={`${rangeLabel} · ${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}`}
        icon={<TrendingUp className="h-5 w-5" />}
        actions={
          <>
            <Button asChild><Link to="/pos"><ShoppingCart className="h-4 w-4 mr-2" />Open POS</Link></Button>
            <Button asChild variant="outline"><Link to="/reports"><Receipt className="h-4 w-4 mr-2" />Reports</Link></Button>
          </>
        }
      />

      {/* Range selector */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={preset} onValueChange={(v) => applyPreset(v as DatePreset)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
            ))}
            {preset === "custom" && <SelectItem value="custom">Custom</SelectItem>}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("justify-start text-left font-normal min-w-[220px]")}>
              <CalendarIcon className="h-4 w-4 mr-2" />
              {format(from, "MMM d, yyyy")} – {format(to, "MMM d, yyyy")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={{ from, to }}
              onSelect={(r: any) => {
                if (r?.from) setFrom(startOfDay(r.from));
                if (r?.to) setTo(startOfDay(r.to));
                else if (r?.from) setTo(startOfDay(r.from));
                setPreset("custom");
              }}
              numberOfMonths={2}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        <Button variant="ghost" size="sm" onClick={() => applyPreset("today")}>Reset to Today</Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <Kpi onClick={() => setDetailKey("net")}
          icon={TrendingUp} label="Revenue" value={fmtMoney(netRevenue, sym)}
          delta={delta} sub={`${sales.length} invoices · after returns`} tone="primary"
        />
        <Kpi onClick={() => setDetailKey("revenue")}
          icon={Receipt} label="Gross sales" value={fmtMoney(revenue, sym)}
          sub="Before returns" tone="info"
        />
        <Kpi onClick={() => setDetailKey("returns")}
          icon={Undo2} label="Returns" value={`- ${fmtMoney(returnsTotal, sym)}`}
          sub={`${saleReturns.length} refund${saleReturns.length === 1 ? "" : "s"}`} tone="warning"
        />
        <Kpi onClick={() => setDetailKey("profit")}
          icon={Wallet} label="Profit" value={fmtMoney(profit, sym)}
          sub="Net of returns" tone="success"
        />
        <Kpi onClick={() => setDetailKey("purch")}
          icon={TrendingDown} label="Purchases" value={fmtMoney(purchTotal, sym)}
          sub={`${purchases.length} entries`} tone="warning"
        />
        <Kpi onClick={() => setDetailKey("inventory")}
          icon={Package} label="Inventory value" value={fmtMoney(inventoryValue, sym)}
          sub={`${products.length} active SKUs`} tone="info"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-semibold">Revenue & profit</h2>
              <p className="text-xs text-muted-foreground">{rangeLabel}</p>
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
          <p className="text-xs text-muted-foreground mb-2">By revenue · {rangeLabel}</p>
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
              <p className="text-xs text-muted-foreground">{rangeLabel}</p>
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
        <Mini onClick={() => setDetailKey("revenue")} label={`Revenue · ${rangeLabel}`} value={fmtMoney(revenue, sym)} icon={TrendingUp} />
        <Mini onClick={() => setDetailKey("net")} label="Net revenue" value={fmtMoney(netRevenue, sym)} icon={TrendingUp} accent />
        <Mini onClick={() => setDetailKey("profit")} label="Profit" value={fmtMoney(profit, sym)} icon={Wallet} accent />
        <Mini onClick={() => setDetailKey("purch")} label="Purchases" value={fmtMoney(purchTotal, sym)} icon={TrendingDown} />
        <Mini onClick={() => setDetailKey("invoices")} label="Invoices" value={String(sales.length)} icon={Users} />
      </div>

      <Dialog open={!!detailKey} onOpenChange={(o) => !o && setDetailKey(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
            <DialogDescription>Total: <span className="font-semibold text-foreground">{detail?.total}</span> · {detail?.rows.length ?? 0} record(s)</DialogDescription>
          </DialogHeader>
          <div className="overflow-auto border rounded-md">
            {detail && detail.rows.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>{detail.cols.map((c) => <th key={c} className="text-left px-3 py-2 font-medium">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {detail.rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      {r.map((cell, j) => <td key={j} className="px-3 py-2">{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">No records</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, delta, sub, tone, onClick,
}: { icon: any; label: string; value: string; delta?: number; sub?: string; tone: string; onClick?: () => void }) {
  const ring: Record<string, string> = {
    primary: "from-primary/15 to-primary/0 text-primary",
    success: "from-success/15 to-success/0 text-success",
    warning: "from-warning/20 to-warning/0 text-accent-foreground",
    info: "from-chart-5/20 to-chart-5/0 text-foreground",
  };
  return (
    <Card onClick={onClick} className={`p-5 relative overflow-hidden ${onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition" : ""}`}>
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

function Mini({ label, value, icon: Icon, accent, onClick }: { label: string; value: string; icon: any; accent?: boolean; onClick?: () => void }) {
  return (
    <Card onClick={onClick} className={`p-4 flex items-center gap-3 ${onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition" : ""}`}>
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
