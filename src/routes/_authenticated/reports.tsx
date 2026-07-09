import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, TrendingUp, TrendingDown, Wallet, Eye, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PRESETS, rangeFor, type DatePreset } from "@/lib/date-presets";

export const Route = createFileRoute("/_authenticated/reports")({ component: Page });

function today() { return new Date().toISOString().slice(0, 10); }
const toISO = (d: Date) => {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};

function Page() {
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "$";
  const [preset, setPreset] = useState<DatePreset | "custom">("today");
  const [fromDate, setFromDate] = useState<Date | undefined>(new Date());
  const [toDate, setToDate] = useState<Date | undefined>(new Date());
  const from = fromDate ? toISO(fromDate) : "1970-01-01";
  const to = toDate ? toISO(toDate) : today();
  const [tab, setTab] = useState("pnl");
  const [search, setSearch] = useState("");

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    const { from: f, to: t } = rangeFor(p);
    setFromDate(f ? new Date(f) : undefined);
    setToDate(t ? new Date(t) : undefined);
  };
  const presetLabel = preset === "custom" ? "Custom range" : (PRESETS.find(p => p.key === preset)?.label ?? "Today");

  const range = { from: new Date(from + "T00:00:00").toISOString(), to: new Date(to + "T23:59:59").toISOString() };


  const { data: sales = [] } = useQuery({
    queryKey: ["report-sales-full", from, to],
    queryFn: async () =>
      (await supabase
        .from("sales")
        .select("id,invoice_no,subtotal,tax,discount,total,cost_total,paid,status,created_at,payment_method,customers(name),sale_items(name,qty,price,cost,line_total,product_id)")
        .gte("created_at", range.from).lte("created_at", range.to)
        .order("created_at", { ascending: false })).data ?? [],
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["report-purchases", from, to],
    queryFn: async () =>
      (await supabase.from("purchases").select("subtotal,tax,total,paid,created_at")
        .gte("created_at", range.from).lte("created_at", range.to)).data ?? [],
  });
  const { data: expenses = [] } = useQuery({
    queryKey: ["report-expenses", from, to],
    queryFn: async () =>
      (await supabase.from("expenses").select("amount,category,expense_date").gte("expense_date", from).lte("expense_date", to)).data ?? [],
  });
  const { data: partyPayments = [] } = useQuery({
    queryKey: ["report-party-payments", from, to],
    queryFn: async () =>
      (await supabase.from("party_payments")
        .select("id,party_type,amount,method,note,created_at,customers(name),suppliers(name)")
        .gte("created_at", range.from).lte("created_at", range.to)
        .order("created_at", { ascending: false })).data ?? [],
  });

  // ---- aggregates
  const revenue = sales.reduce((s, x: any) => s + Number(x.subtotal) - Number(x.discount), 0);
  const cogs = sales.reduce((s, x: any) => s + Number(x.cost_total), 0);
  const grossProfit = revenue - cogs;
  const taxCollected = sales.reduce((s, x: any) => s + Number(x.tax), 0);
  const totalSales = sales.reduce((s, x: any) => s + Number(x.total), 0);
  const totalPurchases = purchases.reduce((s, x: any) => s + Number(x.total), 0);
  const cashIn = sales.reduce((s, x: any) => s + Number(x.paid), 0);
  const creditOut = sales.filter((x: any) => x.status === "credit").reduce((s, x: any) => s + (Number(x.total) - Number(x.paid)), 0);
  const expensesPeriod = expenses.reduce((s, x: any) => s + Number(x.amount), 0);
  const netProfit = grossProfit - expensesPeriod;

  // Daily sale report
  const dailySales = useMemo(() => {
    const map = new Map<string, { date: string; invoices: number; qty: number; revenue: number; tax: number; total: number; profit: number }>();
    for (const s of sales as any[]) {
      const d = new Date(s.created_at).toISOString().slice(0, 10);
      const rev = Number(s.subtotal) - Number(s.discount);
      const profit = rev - Number(s.cost_total);
      const qty = (s.sale_items ?? []).reduce((a: number, i: any) => a + Number(i.qty), 0);
      const cur = map.get(d) ?? { date: d, invoices: 0, qty: 0, revenue: 0, tax: 0, total: 0, profit: 0 };
      cur.invoices += 1; cur.qty += qty; cur.revenue += rev; cur.tax += Number(s.tax); cur.total += Number(s.total); cur.profit += profit;
      map.set(d, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [sales]);

  // Product-wise
  const productSales = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number; cost: number; profit: number }>();
    for (const s of sales as any[]) {
      for (const it of s.sale_items ?? []) {
        const key = it.product_id || it.name;
        const cur = map.get(key) ?? { name: it.name, qty: 0, revenue: 0, cost: 0, profit: 0 };
        const rev = Number(it.line_total);
        const cost = Number(it.cost) * Number(it.qty);
        cur.qty += Number(it.qty); cur.revenue += rev; cur.cost += cost; cur.profit += rev - cost;
        map.set(key, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [sales]);

  // Payment method breakdown
  const paymentBreakdown = useMemo(() => {
    const map = new Map<string, { method: string; invoices: number; total: number; paid: number }>();
    for (const s of sales as any[]) {
      const method = s.payment_method || "unknown";
      const cur = map.get(method) ?? { method, invoices: 0, total: 0, paid: 0 };
      cur.invoices += 1;
      cur.total += Number(s.total);
      cur.paid += Number(s.paid);
      map.set(method, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.paid - a.paid);
  }, [sales]);

  // Combined method cash-flow: money IN (sales + customer party-payments) vs money OUT (supplier party-payments)
  const methodFlow = useMemo(() => {
    const map = new Map<string, { method: string; in_sales: number; in_customer: number; out_supplier: number; net: number }>();
    const get = (m: string) => {
      const cur = map.get(m) ?? { method: m, in_sales: 0, in_customer: 0, out_supplier: 0, net: 0 };
      map.set(m, cur); return cur;
    };
    for (const s of sales as any[]) {
      const cur = get((s.payment_method || "unknown").toLowerCase());
      cur.in_sales += Number(s.paid);
    }
    for (const p of partyPayments as any[]) {
      const cur = get((p.method || "unknown").toLowerCase());
      if (p.party_type === "customer") cur.in_customer += Number(p.amount);
      else cur.out_supplier += Number(p.amount);
    }
    for (const v of map.values()) v.net = v.in_sales + v.in_customer - v.out_supplier;
    return Array.from(map.values()).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [sales, partyPayments]);

  const q = search.trim().toLowerCase();
  const filteredInvoices = useMemo(() => {
    if (!q) return sales as any[];
    return (sales as any[]).filter((s) =>
      String(s.invoice_no ?? "").toLowerCase().includes(q) ||
      String(s.customers?.name ?? "walk-in").toLowerCase().includes(q) ||
      String(s.payment_method ?? "").toLowerCase().includes(q) ||
      String(Number(s.total).toFixed(2)).includes(q) ||
      (s.sale_items ?? []).some((i: any) => String(i.name).toLowerCase().includes(q))
    );
  }, [sales, q]);
  const filteredProducts = useMemo(() => {
    if (!q) return productSales;
    return productSales.filter((p) => p.name.toLowerCase().includes(q));
  }, [productSales, q]);


  return (
    <div className="p-6 space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">Sales, profit, invoice &amp; product breakdowns · {presetLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          {PRESETS.map(p => (
            <Button
              key={p.key}
              variant={preset === p.key ? "default" : "outline"}
              size="sm"
              onClick={() => applyPreset(p.key)}
            >
              {p.label}
            </Button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={preset === "custom" ? "default" : "outline"}
                size="sm"
                className={cn("gap-2")}
              >
                <CalendarIcon className="h-4 w-4" />
                {fromDate && toDate
                  ? `${format(fromDate, "dd MMM")} - ${format(toDate, "dd MMM")}`
                  : "Custom range"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={{ from: fromDate, to: toDate }}
                onSelect={(r) => {
                  setPreset("custom");
                  setFromDate(r?.from);
                  setToDate(r?.to);
                }}
                numberOfMonths={2}
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />Print</Button>
        </div>
      </div>


      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={TrendingUp} label="Revenue" value={fmtMoney(revenue, sym)} tone="primary" />
        <Stat icon={TrendingDown} label="Cost of goods" value={fmtMoney(cogs, sym)} tone="destructive" />
        <Stat icon={Wallet} label="Gross profit" value={fmtMoney(grossProfit, sym)} tone="success" />
        <Stat icon={TrendingDown} label="Expenses (period)" value={fmtMoney(expensesPeriod, sym)} tone="warning" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center justify-between gap-2 flex-wrap no-print">
          <TabsList>
            <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
            <TabsTrigger value="sales">Sale report</TabsTrigger>
            <TabsTrigger value="profit">Sale &amp; profit</TabsTrigger>
            <TabsTrigger value="invoice">Invoice-wise</TabsTrigger>
            <TabsTrigger value="product">Product-wise</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
          </TabsList>
          {(tab === "invoice" || tab === "product") && (
            <Input
              placeholder={tab === "product" ? "Search product name…" : "Search invoice, customer, amount…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 max-w-xs"
            />
          )}
        </div>

        <TabsContent value="pnl">
          <Card className="p-5">
            <h2 className="font-semibold mb-3">Profit &amp; Loss Statement</h2>
            <Table>
              <TableBody>
                <Row label="Sales (net of discount)" value={fmtMoney(revenue, sym)} />
                <Row label="Cost of goods sold" value={`(${fmtMoney(cogs, sym)})`} />
                <Row label="Gross profit" value={fmtMoney(grossProfit, sym)} bold />
                <Row label="Operating expenses" value={`(${fmtMoney(expensesPeriod, sym)})`} />
                <Row label="Tax collected" value={fmtMoney(taxCollected, sym)} muted />
                <Row label="Credit outstanding" value={fmtMoney(creditOut, sym)} muted />
                <Row label="Total purchases (period)" value={fmtMoney(totalPurchases, sym)} muted />
                <Row label="Net profit" value={fmtMoney(netProfit, sym)} bold accent />
              </TableBody>
            </Table>
            <div className="text-xs text-muted-foreground mt-3">{from} → {to} · {sales.length} sales, {purchases.length} purchases, {expenses.length} expenses</div>
          </Card>
        </TabsContent>

        <TabsContent value="sales">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Items qty</TableHead><TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Tax</TableHead><TableHead className="text-right">Total</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {dailySales.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No sales</TableCell></TableRow>}
                {dailySales.map((d) => (
                  <TableRow key={d.date}>
                    <TableCell>{d.date}</TableCell>
                    <TableCell className="text-right">{d.invoices}</TableCell>
                    <TableCell className="text-right">{d.qty}</TableCell>
                    <TableCell className="text-right">{fmtMoney(d.revenue, sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(d.tax, sym)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(d.total, sym)}</TableCell>
                  </TableRow>
                ))}
                {dailySales.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{dailySales.reduce((a, b) => a + b.invoices, 0)}</TableCell>
                    <TableCell className="text-right">{dailySales.reduce((a, b) => a + b.qty, 0)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(revenue, sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(taxCollected, sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(totalSales, sym)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="profit">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin %</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {dailySales.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>}
                {dailySales.map((d) => {
                  const cost = d.revenue - d.profit;
                  const margin = d.revenue ? (d.profit / d.revenue) * 100 : 0;
                  return (
                    <TableRow key={d.date}>
                      <TableCell>{d.date}</TableCell>
                      <TableCell className="text-right">{d.invoices}</TableCell>
                      <TableCell className="text-right">{fmtMoney(d.revenue, sym)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(cost, sym)}</TableCell>
                      <TableCell className="text-right text-success font-medium">{fmtMoney(d.profit, sym)}</TableCell>
                      <TableCell className="text-right">{margin.toFixed(1)}%</TableCell>
                    </TableRow>
                  );
                })}
                {dailySales.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{dailySales.reduce((a, b) => a + b.invoices, 0)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(revenue, sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(cogs, sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(grossProfit, sym)}</TableCell>
                    <TableCell className="text-right">{revenue ? ((grossProfit / revenue) * 100).toFixed(1) : "0.0"}%</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="invoice">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead>
                <TableHead>Method</TableHead><TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Profit</TableHead>
                <TableHead>Status</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredInvoices.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No invoices</TableCell></TableRow>}
                {filteredInvoices.map((s: any) => {
                  const profit = (Number(s.subtotal) - Number(s.discount)) - Number(s.cost_total);
                  const qty = (s.sale_items ?? []).reduce((a: number, i: any) => a + Number(i.qty), 0);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.invoice_no}</TableCell>
                      <TableCell className="text-sm">{new Date(s.created_at).toLocaleString()}</TableCell>
                      <TableCell>{s.customers?.name ?? "Walk-in"}</TableCell>
                      <TableCell className="capitalize">{s.payment_method}</TableCell>
                      <TableCell className="text-right">{qty}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(s.total, sym)}</TableCell>
                      <TableCell className="text-right text-success">{fmtMoney(profit, sym)}</TableCell>
                      <TableCell><Badge variant={s.status === "completed" ? "outline" : s.status === "credit" ? "secondary" : "destructive"}>{s.status}</Badge></TableCell>
                      <TableCell className="text-right"><Button asChild variant="ghost" size="icon"><Link to="/sales"><Eye className="h-4 w-4" /></Link></Button></TableCell>
                    </TableRow>
                  );
                })}
                {filteredInvoices.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={5}>Total ({filteredInvoices.length} invoices{q && ` of ${sales.length}`})</TableCell>
                    <TableCell className="text-right">{fmtMoney(filteredInvoices.reduce((a, b: any) => a + Number(b.total), 0), sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(filteredInvoices.reduce((a, b: any) => a + ((Number(b.subtotal) - Number(b.discount)) - Number(b.cost_total)), 0), sym)}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="product">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty sold</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredProducts.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>}
                {filteredProducts.map((p, i) => {
                  const margin = p.revenue ? (p.profit / p.revenue) * 100 : 0;
                  return (
                    <TableRow key={i}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell className="text-right">{p.qty}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.revenue, sym)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.cost, sym)}</TableCell>
                      <TableCell className="text-right text-success font-medium">{fmtMoney(p.profit, sym)}</TableCell>
                      <TableCell className="text-right">{margin.toFixed(1)}%</TableCell>
                    </TableRow>
                  );
                })}
                {filteredProducts.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>Total ({filteredProducts.length} items{q && ` of ${productSales.length}`})</TableCell>
                    <TableCell className="text-right">{filteredProducts.reduce((a, b) => a + b.qty, 0)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(filteredProducts.reduce((a, b) => a + b.revenue, 0), sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(filteredProducts.reduce((a, b) => a + b.cost, 0), sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(filteredProducts.reduce((a, b) => a + b.profit, 0), sym)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Payment method</TableHead>
                <TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Total billed</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Share %</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {paymentBreakdown.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No payments</TableCell></TableRow>}
                {paymentBreakdown.map((p) => {
                  const totalPaid = paymentBreakdown.reduce((a, b) => a + b.paid, 0);
                  const share = totalPaid ? (p.paid / totalPaid) * 100 : 0;
                  return (
                    <TableRow key={p.method}>
                      <TableCell className="capitalize font-medium">{p.method}</TableCell>
                      <TableCell className="text-right">{p.invoices}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.total, sym)}</TableCell>
                      <TableCell className="text-right text-success font-medium">{fmtMoney(p.paid, sym)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.total - p.paid, sym)}</TableCell>
                      <TableCell className="text-right">{share.toFixed(1)}%</TableCell>
                    </TableRow>
                  );
                })}
                {paymentBreakdown.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{paymentBreakdown.reduce((a, b) => a + b.invoices, 0)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(paymentBreakdown.reduce((a, b) => a + b.total, 0), sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(paymentBreakdown.reduce((a, b) => a + b.paid, 0), sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(paymentBreakdown.reduce((a, b) => a + (b.total - b.paid), 0), sym)}</TableCell>
                    <TableCell className="text-right">100.0%</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: any) {
  const colors: Record<string, string> = { primary: "text-primary", success: "text-success", destructive: "text-destructive", warning: "text-warning" };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${colors[tone]}`}>{value}</div>
    </Card>
  );
}

function Row({ label, value, bold, muted, accent }: any) {
  return (
    <TableRow>
      <TableCell className={muted ? "text-muted-foreground" : ""}>{label}</TableCell>
      <TableCell className={`text-right ${bold ? "font-semibold" : ""} ${accent ? "text-primary text-lg" : ""}`}>{value}</TableCell>
    </TableRow>
  );
}
