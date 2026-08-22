import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  AlertTriangle, Undo2, ArrowUpRight, ArrowDownRight, Receipt, CalendarIcon, CreditCard,
} from "lucide-react";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney, fmtDate } from "@/lib/format";
import { fetchAll } from "@/lib/supabase-page";
import { PRESETS, rangeFor, type DatePreset } from "@/lib/date-presets";
import { useEarliestDataDate } from "@/lib/earliest-date";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Page });

const SPLIT_PAYMENT_PREFIX = "split:";

function parsePaymentSplit(methodValue: string | null | undefined, paidValue: number) {
  const raw = String(methodValue ?? "").trim();
  const paid = +Math.max(0, Number(paidValue || 0)).toFixed(2);
  if (!raw.startsWith(SPLIT_PAYMENT_PREFIX)) return [{ method: raw || "cash", amount: paid }];
  const rows = raw
    .slice(SPLIT_PAYMENT_PREFIX.length)
    .split("|")
    .filter(Boolean)
    .map((part) => {
      const [methodEncoded, amountRaw] = part.split("=");
      let decoded = methodEncoded || "";
      try { decoded = decodeURIComponent(methodEncoded || ""); } catch {}
      return { method: decoded.trim() || "cash", amount: +Math.max(0, Number(amountRaw || 0)).toFixed(2) };
    })
    .filter((entry) => entry.amount > 0);
  return rows.length ? rows : [{ method: "cash", amount: paid }];
}

const displayPaymentMethod = (methodValue: string | null | undefined) =>
  parsePaymentSplit(methodValue, 0).map((r) => r.method).join(" + ");

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function diffDays(a: Date, b: Date) {
  return Math.max(1, Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000) + 1);
}

function Page() {
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";

  // Default range = shop's first ever transaction → today, so historical data is
  // never hidden behind a narrow default. Explicit user selection always wins.
  const { data: earliest } = useEarliestDataDate();
  const [preset, setPreset] = useState<DatePreset | "custom">("all");
  const [from, setFrom] = useState<Date>(new Date(2000, 0, 1));
  const [to, setTo] = useState<Date>(startOfDay(new Date()));
  const [userPicked, setUserPicked] = useState(false);

  useEffect(() => {
    if (userPicked || !earliest) return;
    setFrom(startOfDay(earliest));
    setTo(startOfDay(new Date()));
  }, [earliest, userPicked]);

  const applyPreset = (p: DatePreset) => {
    setUserPicked(true);
    setPreset(p);
    const r = rangeFor(p);
    if (p === "all") {
      const now = new Date();
      setFrom(earliest ? startOfDay(earliest) : new Date(2000, 0, 1));
      setTo(startOfDay(now));
    } else {
      setFrom(startOfDay(new Date(r.from)));
      setTo(startOfDay(new Date(r.to)));
    }
  };


  const fromISO = startOfDay(from).toISOString();
  const toISO = endOfDay(to).toISOString();
  const spanDays = diffDays(from, to);

  const prevFrom = new Date(from.getTime() - spanDays * 86400000);
  const prevTo = new Date(to.getTime() - spanDays * 86400000);
  const prevFromISO = startOfDay(prevFrom).toISOString();
  const prevToISO = endOfDay(prevTo).toISOString();

  const [detailKey, setDetailKey] = useState<string | null>(null);

  const { data: dashboardTimeseries = [] } = useQuery({
    queryKey: ["dash-timeseries", fromISO, toISO],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_dashboard_timeseries", {
        p_from_date: fromISO,
        p_to_date: toISO
      });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: topItems = [] } = useQuery({
    queryKey: ["dash-top-items-rpc", fromISO, toISO],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_top_selling_items", {
        p_from_date: fromISO,
        p_to_date: toISO,
        p_limit: 6
      });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: lowStock = [] } = useQuery({
    queryKey: ["dash-low-stock-rpc"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_low_stock_products", {
        p_threshold: 5,
        p_limit: 6
      });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: inventoryValue = 0 } = useQuery({
    queryKey: ["dash-inventory-value-rpc"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_inventory_value");
      if (error) throw error;
      return Number(data || 0);
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["dash-stats-v2", fromISO, toISO],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_reports_summary", {
        p_from_date: fromISO,
        p_to_date: toISO
      });
      if (error) throw error;
      return data as any;
    },
  });

  const { data: prevStats } = useQuery({
    queryKey: ["dash-stats-prev-v2", prevFromISO, prevToISO],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_reports_summary", {
        p_from_date: prevFromISO,
        p_to_date: prevToISO
      });
      if (error) throw error;
      return data as any;
    },
  });

  const { data: sales = [] } = useQuery({
    queryKey: ["dash-sales-detail", fromISO, toISO],
    queryFn: async () =>
      (await supabase.from("sales").select("total,cost_total,tax,created_at,paid,payment_method,status")
        .gte("created_at", fromISO).lte("created_at", toISO)).data ?? [],
    enabled: !!detailKey && ["revenue", "invoices", "net", "profit"].includes(detailKey),
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["dash-purchases-detail", fromISO, toISO],
    queryFn: async () =>
      (await supabase.from("purchases").select("total,paid,created_at")
        .gte("created_at", fromISO).lte("created_at", toISO)).data ?? [],
    enabled: detailKey === "purch",
  });
  const { data: saleReturns = [] } = useQuery({
    queryKey: ["dash-sale-returns-detail", fromISO, toISO],
    queryFn: async () =>
      (await supabase.from("sale_returns").select("total,subtotal,refund_amount,created_at,sale_return_items(qty,cost)")
        .gte("created_at", fromISO).lte("created_at", toISO)).data ?? [],
    enabled: !!detailKey && ["returns", "profit", "net"].includes(detailKey),
  });
  const { data: products = [] } = useQuery({
    queryKey: ["dash-products-detail"],
    queryFn: async () =>
      fetchAll<any>((from: number, to: number) =>
        supabase
          .from("products")
          .select("id,name,stock,sell_price,cost_price,is_active")
          .eq("is_active", true)
          .range(from, to),
      ),
    enabled: detailKey === "inventory",
  });

  const revenue = Number(stats?.sales_total || 0);
  const creditSales = Number(stats?.credit_sales_total || 0);
  const prevRevenue = Number(prevStats?.sales_total || 0);
  
  // profit = revenue - returns - cost_total
  // We'll calculate it from summary stats
  const salesProfit = Number(stats?.sales_total || 0) - Number(stats?.sales_cost || 0) - Number(stats?.sales_tax || 0);
  const returnsLoss = Number(stats?.returns_total || 0); // Simplified loss from returns
  const profit = salesProfit - returnsLoss;
  
  const prevSalesProfit = Number(prevStats?.sales_total || 0) - Number(prevStats?.sales_cost || 0) - Number(prevStats?.sales_tax || 0);
  const prevReturnsLoss = Number(prevStats?.returns_total || 0);
  const prevProfit = prevSalesProfit - prevReturnsLoss;

  const purchTotal = Number(stats?.purchases_total || 0);
  const prevPurchTotal = Number(prevStats?.purchases_total || 0);
  const returnsTotal = Number(stats?.returns_total || 0);
  const prevReturnsTotal = Number(prevStats?.returns_total || 0);
  
  const netRevenue = revenue - returnsTotal;
  const prevNetRevenue = prevRevenue - prevReturnsTotal;

  const pct = (curr: number, prev: number) => {
    if (!prev) return curr ? 100 : 0;
    return ((curr - prev) / Math.abs(prev)) * 100;
  };
  const dNet = pct(netRevenue, prevNetRevenue);
  const dRevenue = pct(revenue, prevRevenue);
  const dReturns = pct(returnsTotal, prevReturnsTotal);
  const dProfit = pct(profit, prevProfit);
  const dPurch = pct(purchTotal, prevPurchTotal);

  const series = dashboardTimeseries;

  const methodMix = useMemo(() => {
    const m = new Map<string, number>();
    sales.forEach((s: any) => {
      const splits = parsePaymentSplit(s.payment_method, Number(s.paid));
      const sumPaid = splits.reduce((sum, split) => sum + Number(split.amount || 0), 0);
      for (const split of splits) {
        const share = sumPaid > 0 ? Number(split.amount || 0) / sumPaid : 1 / splits.length;
        const key = split.method || "cash";
        m.set(key, (m.get(key) ?? 0) + Number(s.total) * share);
      }
    });
    return Array.from(m, ([name, value]) => ({ name, value }));
  }, [sales]);
  const pieColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-4)", "var(--chart-5)", "var(--chart-3)"];

  const inventoryValueAgg = inventoryValue; // rename to avoid conflict with detail logic if needed, but we replaced the old ones
  const lowStockAgg = lowStock;
  const topItemsAgg = topItems;

  const rangeLabel = preset === "custom"
    ? `${format(from, "MMM d")} – ${format(to, "MMM d, yyyy")}`
    : (PRESETS.find(p => p.key === preset)?.label ?? "Today");

  const detail = useMemo(() => {
    if (!detailKey) return null;
    const fmtDateStr = (d: string) => fmtDate(d);
    const withProfit = (arr: any[]) => arr.map((s:any)=>({...s, profit: Number(s.total)-Number(s.tax)-Number(s.cost_total)}));
    switch (detailKey) {
      case "revenue":
        return { title: `Revenue · ${rangeLabel}`, cols: ["Date", "Method", "Status", "Total"],
          rows: sales.map((s:any)=>[fmtDateStr(s.created_at), displayPaymentMethod(s.payment_method)||"-", s.status||"-", fmtMoney(Number(s.total), sym)]),
          total: fmtMoney(revenue, sym) };
      case "credit":
        return { title: `Credit sales · ${rangeLabel}`, cols: ["Date", "Invoice", "Status", "Total"],
          rows: sales.filter((s:any) => s.status === "credit").map((s:any)=>[fmtDateStr(s.created_at), s.invoice_no||"-", s.status||"-", fmtMoney(Number(s.total), sym)]),
          total: fmtMoney(creditSales, sym) };
      case "profit":
        return { title: `Profit · ${rangeLabel}`, cols: ["Metric", "Amount"],
          rows: [["Sales profit (total − cost − tax)", fmtMoney(salesProfit, sym)], ["Returns loss reversed", `- ${fmtMoney(returnsLoss, sym)}`], ["Net profit", fmtMoney(profit, sym)]],
          total: fmtMoney(profit, sym) };
      case "purch":
        return { title: `Purchases · ${rangeLabel}`, cols: ["Date", "Total", "Paid"],
          rows: purchases.map((p:any)=>[fmtDateStr(p.created_at), fmtMoney(Number(p.total), sym), fmtMoney(Number(p.paid), sym)]),
          total: fmtMoney(purchTotal, sym) };
      case "inventory":
        return { title: "Inventory value", cols: ["Product", "Stock", "Cost", "Value"],
          rows: [...products].sort((a:any,b:any)=>Number(b.stock)*Number(b.cost_price)-Number(a.stock)*Number(a.cost_price)).map((p:any)=>[p.name, String(p.stock), fmtMoney(Number(p.cost_price), sym), fmtMoney(Number(p.stock)*Number(p.cost_price), sym)]),
          total: fmtMoney(inventoryValueAgg, sym) };
      case "returns":
        return { title: `Returns · ${rangeLabel}`, cols: ["Date", "Total", "Refunded"],
          rows: saleReturns.map((r:any)=>[fmtDateStr(r.created_at), fmtMoney(Number(r.total), sym), fmtMoney(Number(r.refund_amount), sym)]),
          total: fmtMoney(returnsTotal, sym) };
      case "invoices":
        return { title: `Invoices · ${rangeLabel}`, cols: ["Date", "Method", "Status", "Total", "Paid"],
          rows: sales.map((s:any)=>[fmtDateStr(s.created_at), displayPaymentMethod(s.payment_method)||"-", s.status||"-", fmtMoney(Number(s.total), sym), fmtMoney(Number(s.paid), sym)]),
          total: `${sales.length} invoices` };
      case "net":
        return { title: `Net revenue · ${rangeLabel}`, cols: ["Metric", "Amount"],
          rows: [["Revenue", fmtMoney(revenue, sym)], ["Returns", `- ${fmtMoney(returnsTotal, sym)}`], ["Net", fmtMoney(netRevenue, sym)]],
          total: fmtMoney(netRevenue, sym) };
    }
    return null;
  }, [detailKey, sales, purchases, saleReturns, products, revenue, profit, purchTotal, returnsTotal, netRevenue, inventoryValueAgg, sym, rangeLabel, salesProfit, returnsLoss]);

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
                setUserPicked(true);
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
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-4">
        <Kpi onClick={() => setDetailKey("net")}
          icon={TrendingUp} label="Revenue" value={fmtMoney(netRevenue, sym)}
          delta={dNet} sub={`${stats?.sales_count || 0} invoices · after returns`} tone="primary"
        />
        <Kpi onClick={() => setDetailKey("revenue")}
          icon={Receipt} label="Gross sales" value={fmtMoney(revenue, sym)}
          delta={dRevenue} sub="Before returns" tone="info"
        />
        <Kpi onClick={() => setDetailKey("credit")}
          icon={CreditCard} label="Credit sales" value={fmtMoney(creditSales, sym)}
          sub="Unpaid portion" tone="warning"
        />
        <Kpi onClick={() => setDetailKey("returns")}
          icon={Undo2} label="Returns" value={`- ${fmtMoney(returnsTotal, sym)}`}
          delta={dReturns} deltaInverse sub={`${saleReturns.length} refund${saleReturns.length === 1 ? "" : "s"}`} tone="warning"
        />
        <Kpi onClick={() => setDetailKey("profit")}
          icon={Wallet} label="Profit" value={fmtMoney(profit, sym)}
          delta={dProfit} sub="Net of returns" tone="success"
        />
        <Kpi onClick={() => setDetailKey("purch")}
          icon={TrendingDown} label="Purchases" value={fmtMoney(purchTotal, sym)}
          delta={dPurch} deltaInverse sub={`${purchases.length} entries`} tone="warning"
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
  icon: Icon, label, value, delta, deltaInverse, sub, tone, onClick,
}: { icon: any; label: string; value: string; delta?: number; deltaInverse?: boolean; sub?: string; tone: string; onClick?: () => void }) {
  const ring: Record<string, string> = {
    primary: "from-primary/15 to-primary/0 text-primary",
    success: "from-success/15 to-success/0 text-success",
    warning: "from-warning/20 to-warning/0 text-accent-foreground",
    info: "from-chart-5/20 to-chart-5/0 text-foreground",
  };
  const hasDelta = delta !== undefined && Number.isFinite(delta);
  const positive = hasDelta ? (deltaInverse ? (delta as number) < 0 : (delta as number) >= 0) : true;
  const deltaClass = !hasDelta
    ? ""
    : (delta === 0
        ? "bg-muted text-muted-foreground"
        : positive
          ? "bg-success/10 text-success"
          : "bg-destructive/10 text-destructive");
  return (
    <Card onClick={onClick} className={`p-5 relative overflow-hidden ${onClick ? "cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200" : ""}`}>
      <div className={`absolute inset-0 bg-gradient-to-br ${ring[tone]} pointer-events-none`} />
      <div className="relative">
        <div className="flex items-start justify-between">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">{label}</div>
          <div className={`h-8 w-8 rounded-lg bg-background/70 backdrop-blur flex items-center justify-center shadow-sm ${ring[tone].split(" ").pop()}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="text-2xl md:text-[1.7rem] font-bold mt-2 tracking-tight tabular-nums">{value}</div>
        <div className="flex items-center justify-between mt-2 gap-2">
          {hasDelta ? (
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${deltaClass}`}>
              {(delta as number) === 0
                ? "—"
                : (delta as number) > 0
                  ? <ArrowUpRight className="h-3 w-3" />
                  : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(delta as number).toFixed(1)}%
            </span>
          ) : <span />}
          <span className="text-[11px] text-muted-foreground truncate text-right">{sub}</span>
        </div>
        {hasDelta && (
          <div className="text-[10px] text-muted-foreground mt-1">vs previous period</div>
        )}
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
