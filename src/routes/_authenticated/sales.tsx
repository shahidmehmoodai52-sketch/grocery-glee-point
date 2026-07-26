import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Printer, Undo2, Ban, CalendarIcon } from "lucide-react";
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

  const { data: allSales = [] } = useQuery({
    queryKey: ["sales"],
    queryFn: async () =>
      (await supabase.from("sales").select("*, customers(name), sale_items(*)").order("created_at", { ascending: false }).limit(1000)).data ?? [],
  });

  const { data: allReturns = [] } = useQuery({
    queryKey: ["sale-returns-on-sales"],
    queryFn: async () =>
      (await supabase.from("sale_returns").select("*, customers(name), sale_return_items(*), sales(invoice_no)").order("created_at", { ascending: false }).limit(1000)).data ?? [],
  });

  const inRange = (iso: string) => {
    const d = new Date(iso);
    if (fromDate) { const f = new Date(fromDate); f.setHours(0, 0, 0, 0); if (d < f) return false; }
    if (toDate) { const t = new Date(toDate); t.setHours(23, 59, 59, 999); if (d > t) return false; }
    return true;
  };

  const sales = useMemo(() => allSales.filter((s: any) => inRange(s.created_at)), [allSales, fromDate, toDate]);
  const returns = useMemo(() => allReturns.filter((r: any) => inRange(r.created_at)), [allReturns, fromDate, toDate]);

  const rangeTotal = sales.reduce((s: number, x: any) => s + Number(x.total), 0);
  const rangeProfit = sales.reduce((s: number, x: any) => s + (Number(x.total) - Number(x.tax) - Number(x.cost_total)), 0);
  const rangeReturns = returns.reduce((s: number, x: any) => s + Number(x.total), 0);
  const netRevenue = rangeTotal - rangeReturns;
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
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{presetLabel} · sales</div>
          <div className="text-2xl font-semibold mt-1">{sales.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{presetLabel} · revenue</div>
          <div className="text-2xl font-semibold mt-1 text-primary">{fmtMoney(rangeTotal, sym)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{presetLabel} · profit</div>
          <div className="text-2xl font-semibold mt-1 text-success">{fmtMoney(rangeProfit, sym)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{presetLabel} · returns</div>
          <div className="text-2xl font-semibold mt-1 text-destructive">-{fmtMoney(rangeReturns, sym)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{returns.length} refund{returns.length === 1 ? "" : "s"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{presetLabel} · net revenue</div>
          <div className="text-2xl font-semibold mt-1">{fmtMoney(netRevenue, sym)}</div>
        </Card>
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
          <DialogHeader><DialogTitle>Invoice {viewing?.invoice_no}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="bg-muted/30 rounded p-3 max-h-[70vh] overflow-auto">
              <div className="print-area">
                <Receipt invoice={viewing} settings={settings} />
              </div>
            </div>
          )}
          <DialogFooter className="no-print">
            <Button onClick={printReceipt}><Printer className="h-4 w-4 mr-2" />Print</Button>
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
