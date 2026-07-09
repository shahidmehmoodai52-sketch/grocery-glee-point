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
import { Receipt } from "@/components/receipt";
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

  const sales = useMemo(() => {
    return allSales.filter((s: any) => {
      const d = new Date(s.created_at);
      if (fromDate) {
        const f = new Date(fromDate); f.setHours(0, 0, 0, 0);
        if (d < f) return false;
      }
      if (toDate) {
        const t = new Date(toDate); t.setHours(23, 59, 59, 999);
        if (d > t) return false;
      }
      return true;
    });
  }, [allSales, fromDate, toDate]);


  const rangeTotal = sales.reduce((s: number, x: any) => s + Number(x.total), 0);
  const rangeProfit = sales.reduce((s: number, x: any) => s + (Number(x.total) - Number(x.tax) - Number(x.cost_total)), 0);
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
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Sales history</h1>
        <p className="text-sm text-muted-foreground">{sales.length} recent invoices</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Today's sales</div>
          <div className="text-2xl font-semibold mt-1">{todaySales.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Today's revenue</div>
          <div className="text-2xl font-semibold mt-1 text-primary">{fmtMoney(todayTotal, sym)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Today's profit</div>
          <div className="text-2xl font-semibold mt-1 text-success">{fmtMoney(todayProfit, sym)}</div>
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
            <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />Print</Button>
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
