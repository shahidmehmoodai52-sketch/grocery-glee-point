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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PRESETS, rangeFor, type DatePreset } from "@/lib/date-presets";
import { NeedsInternetBanner } from "@/components/needs-internet-banner";

export const Route = createFileRoute("/_authenticated/reports")({ component: Page });

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
      return {
        method: decoded.trim() || "cash",
        amount: +Math.max(0, Number(amountRaw || 0)).toFixed(2),
      };
    })
    .filter((entry) => entry.amount > 0);
  return rows.length ? rows : [{ method: "cash", amount: paid }];
}

const displayPaymentMethod = (methodValue: string | null | undefined) => {
  const rows = parsePaymentSplit(methodValue, 0);
  return rows.map((r) => r.method).join(" + ");
};

function today() { return new Date().toISOString().slice(0, 10); }
const toISO = (d: Date) => {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};

function Page() {
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const [preset, setPreset] = useState<DatePreset | "custom">("today");
  const [fromDate, setFromDate] = useState<Date | undefined>(new Date());
  const [toDate, setToDate] = useState<Date | undefined>(new Date());
  const from = fromDate ? toISO(fromDate) : "1970-01-01";
  const to = toDate ? toISO(toDate) : today();
  const [tab, setTab] = useState("pnl");
  const [search, setSearch] = useState("");
  const [drill, setDrill] = useState<null | {
    title: string;
    note?: string;
    invoices?: any[];
    cols?: string[];
    rows?: (string | number)[][];
  }>(null);

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
  const { data: saleReturns = [] } = useQuery({
    queryKey: ["report-sale-returns", from, to],
    queryFn: async () =>
      (await supabase.from("sale_returns")
        .select("id,return_no,total,subtotal,tax,refund_amount,refund_method,created_at,customers(name),sale_return_items(name,qty,price,cost,product_id)")
        .gte("created_at", range.from).lte("created_at", range.to)
        .order("created_at", { ascending: false })).data ?? [],
  });

  // ---- aggregates (net of sale returns)
  const grossRevenue = sales.reduce((s, x: any) => s + Number(x.subtotal) - Number(x.discount), 0);
  const returnsSubtotal = saleReturns.reduce((s, x: any) => s + Number(x.subtotal ?? 0), 0);
  const returnsTax = saleReturns.reduce((s, x: any) => s + Number(x.tax ?? 0), 0);
  const returnsTotal = saleReturns.reduce((s, x: any) => s + Number(x.total ?? 0), 0);
  const returnsRefund = saleReturns.reduce((s, x: any) => s + Number(x.refund_amount ?? 0), 0);
  const returnsCogs = saleReturns.reduce(
    (s, x: any) => s + (x.sale_return_items ?? []).reduce((a: number, i: any) => a + Number(i.qty) * Number(i.cost ?? 0), 0),
    0,
  );
  const revenue = grossRevenue - returnsSubtotal;
  const cogs = sales.reduce((s, x: any) => s + Number(x.cost_total), 0) - returnsCogs;
  const grossProfit = revenue - cogs;
  const taxCollected = sales.reduce((s, x: any) => s + Number(x.tax), 0) - returnsTax;
  const totalSales = sales.reduce((s, x: any) => s + Number(x.total), 0) - returnsTotal;
  const totalPurchases = purchases.reduce((s, x: any) => s + Number(x.total), 0);
  const cashIn = sales.reduce((s, x: any) => s + Number(x.paid), 0) - returnsRefund;
  const creditOut = sales.filter((x: any) => x.status === "credit").reduce((s, x: any) => s + (Number(x.total) - Number(x.paid)), 0);
  const expensesPeriod = expenses.reduce((s, x: any) => s + Number(x.amount), 0);
  const netProfit = grossProfit - expensesPeriod;

  // ---- drill-down helpers (every report row is clickable)
  const openInvoices = (title: string, list: any[], note?: string) =>
    setDrill({ title, note: note ?? `${list.length} invoice${list.length === 1 ? "" : "s"}`, invoices: list });

  const openReturns = (title: string) =>
    setDrill({
      title,
      note: `${saleReturns.length} return${saleReturns.length === 1 ? "" : "s"}`,
      cols: ["Return #", "Date", "Customer", "Subtotal", "Refund", "Total"],
      rows: (saleReturns as any[]).map((r) => [
        r.return_no ?? "—",
        new Date(r.created_at).toLocaleString(),
        r.customers?.name ?? "Walk-in",
        fmtMoney(Number(r.subtotal ?? 0), sym),
        fmtMoney(Number(r.refund_amount ?? 0), sym),
        fmtMoney(Number(r.total ?? 0), sym),
      ]),
    });

  const openExpenses = () =>
    setDrill({
      title: "Operating expenses",
      note: `${expenses.length} entr${expenses.length === 1 ? "y" : "ies"} · ${fmtMoney(expensesPeriod, sym)}`,
      cols: ["Date", "Category", "Amount"],
      rows: (expenses as any[]).map((e) => [e.expense_date, e.category ?? "—", fmtMoney(Number(e.amount), sym)]),
    });

  const openPurchases = () =>
    setDrill({
      title: "Purchases (period)",
      note: `${purchases.length} purchase${purchases.length === 1 ? "" : "s"} · ${fmtMoney(totalPurchases, sym)}`,
      cols: ["Date", "Subtotal", "Tax", "Total", "Paid"],
      rows: (purchases as any[]).map((p) => [
        new Date(p.created_at).toLocaleString(),
        fmtMoney(Number(p.subtotal ?? 0), sym),
        fmtMoney(Number(p.tax ?? 0), sym),
        fmtMoney(Number(p.total ?? 0), sym),
        fmtMoney(Number(p.paid ?? 0), sym),
      ]),
    });


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
    // Subtract returned qty/revenue/cost per product so product-wise report reflects net sales
    for (const r of saleReturns as any[]) {
      for (const it of r.sale_return_items ?? []) {
        const key = it.product_id || it.name;
        const cur = map.get(key);
        if (!cur) continue;
        const rev = Number(it.qty) * Number(it.price);
        const cost = Number(it.qty) * Number(it.cost ?? 0);
        cur.qty -= Number(it.qty); cur.revenue -= rev; cur.cost -= cost; cur.profit -= rev - cost;
        map.set(key, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [sales, saleReturns]);

  // Payment method breakdown
  const paymentBreakdown = useMemo(() => {
    const map = new Map<string, { method: string; invoices: number; total: number; paid: number }>();
    for (const s of sales as any[]) {
      const splits = parsePaymentSplit(s.payment_method, Number(s.paid));
      const splitPaidTotal = splits.reduce((sum, split) => sum + Number(split.amount || 0), 0);
      for (const split of splits) {
        const method = split.method || "unknown";
        const cur = map.get(method) ?? { method, invoices: 0, total: 0, paid: 0 };
        const share = splitPaidTotal > 0 ? Number(split.amount || 0) / splitPaidTotal : 1 / splits.length;
        cur.invoices += 1;
        cur.total += Number(s.total) * share;
        cur.paid += Number(split.amount || 0);
        map.set(method, cur);
      }
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
      const splits = parsePaymentSplit(s.payment_method, Number(s.paid));
      for (const split of splits) {
        const cur = get((split.method || "unknown").toLowerCase());
        cur.in_sales += Number(split.amount || 0);
      }
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
      displayPaymentMethod(s.payment_method).toLowerCase().includes(q) ||
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
      <NeedsInternetBanner section="Reports" />
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
                <Row label="Gross sales (before returns)" value={fmtMoney(grossRevenue, sym)} muted onClick={() => openInvoices("Gross sales (before returns)", sales as any[])} />
                <Row label="Sale returns" value={`(${fmtMoney(returnsSubtotal, sym)})`} muted onClick={() => openReturns("Sale returns")} />
                <Row label="Sales (net of returns & discount)" value={fmtMoney(revenue, sym)} onClick={() => openInvoices("Sales (net of returns & discount)", sales as any[])} />
                <Row label="Cost of goods sold" value={`(${fmtMoney(cogs, sym)})`} onClick={() => openInvoices("Cost of goods sold", sales as any[])} />
                <Row label="Gross profit" value={fmtMoney(grossProfit, sym)} bold onClick={() => openInvoices("Gross profit", sales as any[])} />
                <Row label="Operating expenses" value={`(${fmtMoney(expensesPeriod, sym)})`} onClick={openExpenses} />
                <Row label="Tax collected" value={fmtMoney(taxCollected, sym)} muted onClick={() => openInvoices("Tax collected", (sales as any[]).filter((s) => Number(s.tax) > 0))} />
                <Row label="Credit outstanding" value={fmtMoney(creditOut, sym)} muted onClick={() => openInvoices("Credit outstanding", (sales as any[]).filter((s) => s.status === "credit" && Number(s.total) - Number(s.paid) > 0))} />
                <Row label="Total purchases (period)" value={fmtMoney(totalPurchases, sym)} muted onClick={openPurchases} />
                <Row label="Net profit" value={fmtMoney(netProfit, sym)} bold accent onClick={() => openInvoices("Net profit basis · all invoices", sales as any[])} />

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
                  <TableRow
                    key={d.date}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openInvoices(`Sales on ${d.date}`, (sales as any[]).filter((s) => new Date(s.created_at).toISOString().slice(0, 10) === d.date))}
                  >
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
                    <TableRow
                      key={d.date}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openInvoices(`Sales & profit on ${d.date}`, (sales as any[]).filter((s) => new Date(s.created_at).toISOString().slice(0, 10) === d.date))}
                    >
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
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setDrill({
                        title: `Invoice ${s.invoice_no}`,
                        note: `${new Date(s.created_at).toLocaleString()} · ${s.customers?.name ?? "Walk-in"} · ${displayPaymentMethod(s.payment_method)} · Total ${fmtMoney(Number(s.total), sym)} · Paid ${fmtMoney(Number(s.paid), sym)}`,
                        cols: ["Item", "Qty", "Price", "Line total"],
                        rows: (s.sale_items ?? []).map((i: any) => [
                          i.name,
                          Number(i.qty),
                          fmtMoney(Number(i.price), sym),
                          fmtMoney(Number(i.line_total), sym),
                        ]),
                      })}
                    >
                      <TableCell className="font-mono text-xs">{s.invoice_no}</TableCell>
                      <TableCell className="text-sm">{new Date(s.created_at).toLocaleString()}</TableCell>
                      <TableCell>{s.customers?.name ?? "Walk-in"}</TableCell>
                      <TableCell className="capitalize">{displayPaymentMethod(s.payment_method)}</TableCell>
                      <TableCell className="text-right">{qty}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(s.total, sym)}</TableCell>
                      <TableCell className="text-right text-success">{fmtMoney(profit, sym)}</TableCell>
                      <TableCell><Badge variant={s.status === "completed" ? "outline" : s.status === "credit" ? "secondary" : "destructive"}>{s.status}</Badge></TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}><Button asChild variant="ghost" size="icon"><Link to="/sales"><Eye className="h-4 w-4" /></Link></Button></TableCell>
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
                    <TableRow
                      key={i}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        const rows: (string | number)[][] = [];
                        for (const s of sales as any[]) {
                          for (const it of s.sale_items ?? []) {
                            if (it.name !== p.name) continue;
                            rows.push([
                              s.invoice_no,
                              new Date(s.created_at).toLocaleString(),
                              s.customers?.name ?? "Walk-in",
                              Number(it.qty),
                              fmtMoney(Number(it.line_total), sym),
                            ]);
                          }
                        }
                        setDrill({
                          title: p.name,
                          note: `${rows.length} invoice line${rows.length === 1 ? "" : "s"} · Qty ${p.qty} · Revenue ${fmtMoney(p.revenue, sym)}`,
                          cols: ["Invoice", "Date", "Customer", "Qty", "Amount"],
                          rows,
                        });
                      }}
                    >
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

          <Card className="p-3 mt-4">
            <div className="mb-2">
              <div className="text-sm font-semibold">Money flow by payment channel</div>
              <div className="text-xs text-muted-foreground">Tracks each channel (cash, card, JazzCash, EasyPaisa…) — money received via sales & customer payments vs money paid out to suppliers.</div>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">In · Sales</TableHead>
                <TableHead className="text-right">In · Customer payments</TableHead>
                <TableHead className="text-right">Out · Supplier payments</TableHead>
                <TableHead className="text-right">Net (In − Out)</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {methodFlow.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No activity</TableCell></TableRow>}
                {methodFlow.map((m) => (
                  <TableRow key={m.method}>
                    <TableCell className="capitalize font-medium">{m.method}</TableCell>
                    <TableCell className="text-right text-success">{m.in_sales ? fmtMoney(m.in_sales, sym) : "—"}</TableCell>
                    <TableCell className="text-right text-success">{m.in_customer ? fmtMoney(m.in_customer, sym) : "—"}</TableCell>
                    <TableCell className="text-right text-destructive">{m.out_supplier ? fmtMoney(m.out_supplier, sym) : "—"}</TableCell>
                    <TableCell className={`text-right font-semibold ${m.net > 0 ? "text-success" : m.net < 0 ? "text-destructive" : ""}`}>{fmtMoney(m.net, sym)}</TableCell>
                  </TableRow>
                ))}
                {methodFlow.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(methodFlow.reduce((a, b) => a + b.in_sales, 0), sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(methodFlow.reduce((a, b) => a + b.in_customer, 0), sym)}</TableCell>
                    <TableCell className="text-right text-destructive">{fmtMoney(methodFlow.reduce((a, b) => a + b.out_supplier, 0), sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(methodFlow.reduce((a, b) => a + b.net, 0), sym)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>

          <Card className="p-3 mt-4">
            <div className="mb-2 text-sm font-semibold">Party payment log</div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(partyPayments as any[]).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No party payments</TableCell></TableRow>}
                {(partyPayments as any[]).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap text-xs">{new Date(p.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      {p.party_type === "customer"
                        ? <span className="text-success font-medium">In · from customer</span>
                        : <span className="text-destructive font-medium">Out · to supplier</span>}
                    </TableCell>
                    <TableCell>{p.customers?.name ?? p.suppliers?.name ?? "—"}</TableCell>
                    <TableCell className="capitalize">{p.method || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{p.note || "—"}</TableCell>
                    <TableCell className={`text-right font-medium ${p.party_type === "customer" ? "text-success" : "text-destructive"}`}>
                      {p.party_type === "customer" ? "+" : "−"}{fmtMoney(Number(p.amount), sym)}
                    </TableCell>
                  </TableRow>
                ))}
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
