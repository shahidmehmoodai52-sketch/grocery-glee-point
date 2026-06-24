import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { Receipt } from "@/components/receipt";


export const Route = createFileRoute("/_authenticated/sales")({ component: Page });

function Page() {
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "$";
  const [viewing, setViewing] = useState<any>(null);

  const { data: sales = [] } = useQuery({
    queryKey: ["sales"],
    queryFn: async () =>
      (await supabase.from("sales").select("*, customers(name), sale_items(*)").order("created_at", { ascending: false }).limit(200)).data ?? [],
  });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todaySales = sales.filter((s: any) => new Date(s.created_at) >= today);
  const todayTotal = todaySales.reduce((s: number, x: any) => s + Number(x.total), 0);
  const todayProfit = todaySales.reduce((s: number, x: any) => s + (Number(x.total) - Number(x.tax) - Number(x.cost_total)), 0);

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
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setViewing(s)}><Eye className="h-4 w-4" /></Button>
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

    </div>
  );
}
