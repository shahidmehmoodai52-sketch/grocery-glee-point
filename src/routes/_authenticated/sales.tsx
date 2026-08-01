import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Printer, Undo2, Ban, CalendarIcon, ArrowUpRight, ArrowDownRight, Receipt as ReceiptIcon, Wallet, TrendingUp, TrendingDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { Receipt, printReceipt } from "@/components/receipt";
import { cn } from "@/lib/utils";
import { PRESETS, rangeFor, type DatePreset } from "@/lib/date-presets";


export const Route = createFileRoute("/_authenticated/sales")({ component: Page });

function Page() {
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs.";
  const qc = useQueryClient();
  const [viewing, setViewing] = useState<any>(null);
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const voidRequireReason = !!(settings as any)?.ops_void_requires_reason;

  const [preset, setPreset] = useState<DatePreset | "custom">("today");
  const [fromDate, setFromDate] = useState<Date | undefined>(new Date());
  const [toDate, setToDate] = useState<Date | undefined>(new Date());

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    const { from, to } = rangeFor(p);
    setFromDate(from ? new Date(from) : undefined);
    setToDate(to ? new Date(to) : undefined);
  };

  // Previous comparable range (declared first so fetches can cover both windows)
  const { prevFrom, prevTo } = useMemo(() => {
    if (!fromDate || !toDate) return { prevFrom: undefined, prevTo: undefined };
    const f = new Date(fromDate); f.setHours(0, 0, 0, 0);
    const t = new Date(toDate); t.setHours(0, 0, 0, 0);
    const spanDays = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
    const pTo = new Date(f.getTime() - 86400000);
    const pFrom = new Date(pTo.getTime() - (spanDays - 1) * 86400000);
    return { prevFrom: pFrom, prevTo: pTo };
  }, [fromDate, toDate]);

  // Server-side window: only the selected range + the comparison range are fetched.
  const window = useMemo(() => {
    const start = prevFrom ?? fromDate;
    const startIso = start ? (() => { const d = new Date(start); d.setHours(0, 0, 0, 0); return d.toISOString(); })() : null;
    const endIso = toDate ? (() => { const d = new Date(toDate); d.setHours(23, 59, 59, 999); return d.toISOString(); })() : null;
    return { startIso, endIso };
  }, [prevFrom, fromDate, toDate]);

  const rangedQuery = (table: "sales" | "sale_returns", cols: string) => async () => {
    let q = supabase.from(table).select(cols).order("created_at", { ascending: false }).limit(5000);
    if (window.startIso) q = q.gte("created_at", window.startIso);
    if (window.endIso) q = q.lte("created_at", window.endIso);
    return ((await q).data as any[]) ?? [];
  };

  const { data: allSales = [] } = useQuery({
    queryKey: ["sales", window.startIso, window.endIso],
    queryFn: rangedQuery("sales", "*, customers(name), sale_items(*)"),
    staleTime: 30_000,
  });

  const { data: allReturns = [] } = useQuery({
    queryKey: ["sale-returns-on-sales", window.startIso, window.endIso],
    queryFn: rangedQuery("sale_returns", "*, customers(name), sale_return_items(*), sales(invoice_no)"),
    staleTime: 30_000,
  });

  const inRange = (iso: string, f?: Date, t?: Date) => {
    const d = new Date(iso);
    if (f) { const x = new Date(f); x.setHours(0, 0, 0, 0); if (d < x) return false; }
    if (t) { const x = new Date(t); x.setHours(23, 59, 59, 999); if (d > x) return false; }
    return true;
  };

  const sales = useMemo(() => allSales.filter((s: any) => inRange(s.created_at, fromDate, toDate)), [allSales, fromDate, toDate]);
  const returns = useMemo(() => allReturns.filter((r: any) => inRange(r.created_at, fromDate, toDate)), [allReturns, fromDate, toDate]);

  const prevSales = useMemo(() => allSales.filter((s: any) => inRange(s.created_at, prevFrom, prevTo)), [allSales, prevFrom, prevTo]);
  const prevReturnsArr = useMemo(() => allReturns.filter((r: any) => inRange(r.created_at, prevFrom, prevTo)), [allReturns, prevFrom, prevTo]);

  const rangeTotal = sales.reduce((s: number, x: any) => s + Number(x.total), 0);
  const salesProfit = sales.reduce((s: number, x: any) => s + (Number(x.total) - Number(x.tax) - Number(x.cost_total)), 0);
  const rangeReturns = returns.reduce((s: number, x: any) => s + Number(x.total), 0);
  const returnsProfit = returns.reduce((s: number, r: any) => {
    const items = r.sale_return_items ?? [];
    const itemsCost = items.reduce((c: number, it: any) => c + Number(it.cost ?? 0) * Number(it.qty ?? 0), 0);
    return s + (Number(r.subtotal ?? r.total) - itemsCost);
  }, 0);
  const netRevenue = rangeTotal - rangeReturns;
  const rangeProfit = salesProfit - returnsProfit;

  const prevRangeTotal = prevSales.reduce((s: number, x: any) => s + Number(x.total), 0);
  const prevSalesProfit = prevSales.reduce((s: number, x: any) => s + (Number(x.total) - Number(x.tax) - Number(x.cost_total)), 0);
  const prevRangeReturns = prevReturnsArr.reduce((s: number, x: any) => s + Number(x.total), 0);
  const prevReturnsProfit = prevReturnsArr.reduce((s: number, r: any) => {
    const items = r.sale_return_items ?? [];
    const itemsCost = items.reduce((c: number, it: any) => c + Number(it.cost ?? 0) * Number(it.qty ?? 0), 0);
    return s + (Number(r.subtotal ?? r.total) - itemsCost);
  }, 0);
  const prevNetRevenue = prevRangeTotal - prevRangeReturns;
  const prevProfit = prevSalesProfit - prevReturnsProfit;

  const pct = (curr: number, prev: number) => {
    if (!prev) return curr ? 100 : 0;
    return ((curr - prev) / Math.abs(prev)) * 100;
  };
  const dCount = pct(sales.length, prevSales.length);
  const dRev = pct(netRevenue, prevNetRevenue);
  const dGross = pct(rangeTotal, prevRangeTotal);
  const dRet = pct(rangeReturns, prevRangeReturns);
  const dProf = pct(rangeProfit, prevProfit);

  const presetLabel = preset === "custom" ? "Custom range" : (PRESETS.find(p => p.key === preset)?.label ?? "Today");



  const confirmVoid = async () => {
    if (!voidTarget) return;
    if (voidRequireReason && !voidReason.trim()) return toast.error("Reason required");
    setVoiding(true);
    const { error } = await supabase.rpc("void_sale", {
      _sale_id: voidTarget.id, _reason: voidReason.trim() || "voided",
    });
    setVoiding(false);
    if (error) return toast.error(error.message);
    toast.success(`Sale ${voidTarget.invoice_no} voided`);
    setVoidTarget(null); setVoidReason("");
    qc.invalidateQueries({ queryKey: ["sales"] });
    qc.invalidateQueries({ queryKey: ["sale-returns-on-sales"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sales history</h1>
          <p className="text-sm text-muted-foreground">{sales.length} invoices · {presetLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard icon={ReceiptIcon} tone="info" label={`${presetLabel} · invoices`} value={String(sales.length)} delta={dCount} sub={`${prevSales.length} last period`} />
        <KpiCard icon={TrendingUp} tone="primary" label={`${presetLabel} · revenue`} value={fmtMoney(netRevenue, sym)} delta={dRev} sub="After returns" />
        <KpiCard icon={TrendingUp} tone="info" label={`${presetLabel} · gross sales`} value={fmtMoney(rangeTotal, sym)} delta={dGross} sub="Before returns" />
        <KpiCard icon={Undo2} tone="destructive" label={`${presetLabel} · returns`} value={`-${fmtMoney(rangeReturns, sym)}`} delta={dRet} deltaInverse sub={`${returns.length} refund${returns.length === 1 ? "" : "s"}`} />
        <KpiCard icon={Wallet} tone="success" label={`${presetLabel} · profit`} value={fmtMoney(rangeProfit, sym)} delta={dProf} sub="Net of returns" />
      </div>



      <Card className="p-3">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead>
            <TableHead>Method</TableHead><TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Paid</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {sales.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No sales yet</TableCell></TableRow>}
            {sales.map((s: any) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs">{s.invoice_no}</TableCell>
                <TableCell className="text-sm">{new Date(s.created_at).toLocaleString()}</TableCell>
                <TableCell>{s.customers?.name ?? "Walk-in"}</TableCell>
                <TableCell className="capitalize">{s.payment_method}</TableCell>
                <TableCell className="text-right font-medium">{fmtMoney(s.total, sym)}</TableCell>
                <TableCell className="text-right">{fmtMoney(s.paid, sym)}</TableCell>
                <TableCell>
                  <Badge variant={s.status === "completed" ? "outline" : s.status === "credit" ? "secondary" : "destructive"}>
                    {s.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button asChild variant="ghost" size="sm" title="Create return">
                    <Link to="/sale-returns"><Undo2 className="h-4 w-4" /></Link>
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setViewing(s)} title="View invoice"><Eye className="h-4 w-4" /></Button>
                  {s.status !== "voided" && (
                    <Button variant="ghost" size="icon" onClick={() => { setVoidTarget(s); setVoidReason(""); }} title="Void sale">
                      <Ban className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between pt-2">
        <div>
          <h2 className="text-lg font-semibold">Sale returns</h2>
          <p className="text-xs text-muted-foreground">{returns.length} refund{returns.length === 1 ? "" : "s"} · stock restored automatically</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/sale-returns"><Undo2 className="h-4 w-4 mr-1" />New return</Link>
        </Button>
      </div>
      <Card className="p-3">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Return #</TableHead><TableHead>Date</TableHead><TableHead>Original invoice</TableHead>
            <TableHead>Customer</TableHead><TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Refund</TableHead><TableHead>Method</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {returns.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No returns in this range</TableCell></TableRow>}
            {returns.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.return_no}</TableCell>
                <TableCell className="text-sm">{new Date(r.created_at).toLocaleString()}</TableCell>
                <TableCell className="font-mono text-xs">{r.sales?.invoice_no ?? "—"}</TableCell>
                <TableCell>{r.customers?.name ?? "Walk-in"}</TableCell>
                <TableCell className="text-right font-medium text-destructive">-{fmtMoney(r.total, sym)}</TableCell>
                <TableCell className="text-right">{fmtMoney(r.refund_amount, sym)}</TableCell>
                <TableCell><Badge variant="outline" className="capitalize">{r.refund_method}</Badge></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setViewing({ ...r, __isReturn: true, sale_items: r.sale_return_items })} title="View return">
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{viewing?.__isReturn ? `Return ${viewing?.return_no}` : `Invoice ${viewing?.invoice_no}`}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="bg-muted/30 rounded p-3 max-h-[70vh] overflow-auto">
              <div className="print-area">
                {viewing.__isReturn
                  ? <Receipt kind="sale-return" invoice={viewing} settings={settings} />
                  : <Receipt invoice={viewing} settings={settings} />}
              </div>
            </div>
          )}
          <DialogFooter className="no-print">
            <Button onClick={() => printReceipt()}><Printer className="h-4 w-4 mr-2" />Print</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Void sale {voidTarget?.invoice_no}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Voiding restores stock and reverses ledger entries. This action is logged.
            </p>
            <div>
              <label className="text-xs font-medium">Reason {voidRequireReason && <span className="text-destructive">*</span>}</label>
              <Textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Why is this sale being voided?"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmVoid} disabled={voiding}>
              {voiding ? "Voiding…" : "Void sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, delta, deltaInverse, sub, tone,
}: {
  icon: any; label: string; value: string; delta?: number; deltaInverse?: boolean; sub?: string;
  tone: "primary" | "success" | "info" | "warning" | "destructive";
}) {
  const ring: Record<string, string> = {
    primary: "from-primary/15 to-primary/0 text-primary",
    success: "from-success/15 to-success/0 text-success",
    info: "from-chart-5/20 to-chart-5/0 text-foreground",
    warning: "from-warning/20 to-warning/0 text-accent-foreground",
    destructive: "from-destructive/15 to-destructive/0 text-destructive",
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
    <Card className="p-4 relative overflow-hidden">
      <div className={`absolute inset-0 bg-gradient-to-br ${ring[tone]} pointer-events-none`} />
      <div className="relative">
        <div className="flex items-start justify-between">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">{label}</div>
          <div className={`h-8 w-8 rounded-lg bg-background/70 backdrop-blur flex items-center justify-center shadow-sm ${ring[tone].split(" ").pop()}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="text-2xl font-bold mt-2 tracking-tight tabular-nums">{value}</div>
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
          {sub && <span className="text-[11px] text-muted-foreground truncate text-right">{sub}</span>}
        </div>
        {hasDelta && <div className="text-[10px] text-muted-foreground mt-1">vs previous period</div>}
      </div>
    </Card>
  );
}
