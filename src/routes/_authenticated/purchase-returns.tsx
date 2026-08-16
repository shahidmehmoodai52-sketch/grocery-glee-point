import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Eye, Printer, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { roundToTillixQty } from "@/lib/quantity-rounding";
import { Receipt, printReceipt } from "@/components/receipt";
import { fetchAll } from "@/lib/supabase-page";

export const Route = createFileRoute("/_authenticated/purchase-returns")({ component: Page });

type Line = { product_id: string | null; name: string; qty: number; cost: number };

function Page() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";

  const [open, setOpen] = useState(false);
  const [purchaseId, setPurchaseId] = useState<string>("none");
  const [supplier, setSupplier] = useState<string>("none");
  const [lines, setLines] = useState<Line[]>([]);
  const [tax, setTax] = useState(0);
  const [refund, setRefund] = useState(0);
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [viewing, setViewing] = useState<any>(null);

  const { data: returns = [] } = useQuery({
    queryKey: ["purchase-returns"],
    queryFn: async () =>
      await fetchAll<any>((from: number, to: number) => supabase.from("purchase_returns").select("*, suppliers(name), purchase_return_items(*)").order("created_at", { ascending: false }).range(from, to)),
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases-for-return"],
    queryFn: async () =>
      await fetchAll<any>((from: number, to: number) => supabase.from("purchases").select("id,invoice_no,supplier_id,total,created_at,purchase_items(*)").order("created_at", { ascending: false }).range(from, to)),
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => fetchAll<any>((from: number, to: number) => supabase.from("products").select("id,name,cost_price").order("name").range(from, to)),
  });

  useEffect(() => {
    if (purchaseId === "none") return;
    const p = purchases.find((x: any) => x.id === purchaseId);
    if (!p) return;
    setSupplier(p.supplier_id ?? "none");
    setLines(
      (p.purchase_items ?? []).map((it: any) => ({
        product_id: it.product_id,
        name: it.name,
        qty: Number(it.qty),
        cost: Number(it.cost),
      })),
    );
  }, [purchaseId, purchases]);

  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.qty * l.cost, 0), [lines]);
  const total = subtotal + Number(tax || 0);

  const addLine = () => setLines((l) => [...l, { product_id: null, name: "", qty: 1, cost: 0 }]);
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) =>
      ls.map((l, idx) =>
        idx === i
          ? {
              ...l,
              ...patch,
              qty: "qty" in patch ? roundToTillixQty(Number(patch.qty)) : l.qty,
            }
          : l
      )
    );

  const reset = () => {
    setOpen(false); setLines([]); setPurchaseId("none"); setSupplier("none");
    setTax(0); setRefund(0); setMethod("cash"); setNote("");
  };

  const submit = async () => {
    const items = lines.filter((l) => l.name && l.qty > 0);
    if (!items.length) return toast.error("Add at least one item");
    if (refund > total) return toast.error("Refund cannot exceed total");
    const { error } = await supabase.rpc("complete_purchase_return" as any, {
      payload: {
        purchase_id: purchaseId === "none" ? null : purchaseId,
        supplier_id: supplier === "none" ? null : supplier,
        tax, refund_amount: refund, refund_method: method, note,
        items: items.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty, cost: l.cost })),
      },
    });
    if (error) return toast.error(error.message);
    toast.success("Purchase return recorded, stock removed");
    reset();
    qc.invalidateQueries({ queryKey: ["purchase-returns"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Purchase Returns</h1>
          <p className="text-sm text-muted-foreground">Send stock back to suppliers</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New return</Button></DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>New purchase return</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Original purchase (optional)</Label>
                  <Select value={purchaseId} onValueChange={setPurchaseId}>
                    <SelectTrigger><SelectValue placeholder="Pick a purchase to copy items" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {purchases.map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.invoice_no} · {fmtMoney(p.total, sym)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Supplier</Label>
                  <Select value={supplier} onValueChange={setSupplier}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="border rounded-md">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Product</TableHead><TableHead>Name</TableHead>
                    <TableHead className="w-24">Qty</TableHead><TableHead className="w-28">Cost</TableHead>
                    <TableHead className="text-right w-28">Total</TableHead><TableHead className="w-10"></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {lines.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Select
                            value={l.product_id ?? "new"}
                            onValueChange={(v) => {
                              if (v === "new") { setLine(i, { product_id: null }); return; }
                              const p = products.find((p: any) => p.id === v);
                              setLine(i, { product_id: v, name: p?.name ?? "", cost: Number(p?.cost_price ?? 0) });
                            }}
                          >
                            <SelectTrigger className="h-8"><SelectValue placeholder="Pick…" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="new">— Ad-hoc —</SelectItem>
                              {products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} className="h-8" /></TableCell>
                        <TableCell><Input type="number" step="0.001" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} className="h-8" /></TableCell>
                        <TableCell><Input type="number" step="0.01" value={l.cost} onChange={(e) => setLine(i, { cost: Number(e.target.value) })} className="h-8" /></TableCell>
                        <TableCell className="text-right font-medium">{fmtMoney(l.qty * l.cost, sym)}</TableCell>
                        <TableCell><Button variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, x) => x !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="p-2"><Button variant="outline" size="sm" onClick={addLine}><Plus className="h-3.5 w-3.5 mr-1" />Add row</Button></div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div><Label>Tax</Label><Input type="number" step="0.01" value={tax || ""} onChange={(e) => setTax(Number(e.target.value))} /></div>
                <div><Label>Refund received</Label><Input type="number" step="0.01" value={refund || ""} onChange={(e) => setRefund(Number(e.target.value))} /></div>
                <div>
                  <Label>Method</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="transfer">Transfer</SelectItem>
                      <SelectItem value="credit">Supplier credit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col justify-end">
                  <div className="text-sm text-muted-foreground">Total</div>
                  <div className="text-2xl font-semibold text-primary">{fmtMoney(total, sym)}</div>
                </div>
              </div>
              <div><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>Cancel</Button>
              <Button onClick={submit}><Undo2 className="h-4 w-4 mr-2" />Process return</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-3">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Return #</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead>
            <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Refund</TableHead>
            <TableHead>Method</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {returns.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No returns yet</TableCell></TableRow>}
            {returns.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.return_no}</TableCell>
                <TableCell className="text-sm">{new Date(r.created_at).toLocaleString()}</TableCell>
                <TableCell>{r.suppliers?.name ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">{fmtMoney(r.total, sym)}</TableCell>
                <TableCell className="text-right">{fmtMoney(r.refund_amount, sym)}</TableCell>
                <TableCell><Badge variant="outline" className="capitalize">{r.refund_method}</Badge></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setViewing(r)}><Eye className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Return {viewing?.return_no}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="bg-muted/30 rounded p-3 max-h-[70vh] overflow-auto">
              <div className="print-area">
                <Receipt
                  kind="purchase-return"
                  invoice={{
                    ...viewing,
                    sale_items: (viewing.purchase_return_items ?? []).map((it: any) => ({
                      ...it, price: it.cost,
                    })),
                  }}
                  settings={settings}
                />
              </div>
            </div>
          )}
          <DialogFooter className="no-print">
            <Button onClick={() => printReceipt()}><Printer className="h-4 w-4 mr-2" />Print</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
