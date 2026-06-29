import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { usePersistentState } from "@/hooks/use-persistent-state";

export const Route = createFileRoute("/_authenticated/purchases")({ component: Page });

type Line = { product_id: string | null; name: string; qty: number; cost: number; old_stock?: number; old_cost?: number };

type Draft = {
  open: boolean;
  supplier: string;
  lines: Line[];
  tax: number;
  paid: number;
  note: string;
};
const emptyDraft: Draft = { open: false, supplier: "none", lines: [], tax: 0, paid: 0, note: "" };

function Page() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "$";

  const [draft, setDraft, clearDraft] = usePersistentState<Draft>("purchase-entry", emptyDraft);
  const { open, supplier, lines, tax, paid, note } = draft;
  const setOpen = (v: boolean) => setDraft((d) => ({ ...d, open: v }));
  const setSupplier = (v: string) => setDraft((d) => ({ ...d, supplier: v }));
  const setLines = (updater: Line[] | ((l: Line[]) => Line[])) =>
    setDraft((d) => ({ ...d, lines: typeof updater === "function" ? (updater as any)(d.lines) : updater }));
  const setTax = (v: number) => setDraft((d) => ({ ...d, tax: v }));
  const setPaid = (v: number) => setDraft((d) => ({ ...d, paid: v }));
  const setNote = (v: string) => setDraft((d) => ({ ...d, note: v }));


  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("id,name,cost_price,stock").order("name")).data ?? [],
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases"],
    queryFn: async () => (await supabase.from("purchases").select("*, suppliers(name)").order("created_at", { ascending: false }).limit(100)).data ?? [],
  });

  const subtotal = lines.reduce((s, l) => s + l.qty * l.cost, 0);
  const total = subtotal + Number(tax || 0);

  const addLine = () => setLines((l) => [...l, { product_id: null, name: "", qty: 1, cost: 0 }]);
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    const items = lines.filter((l) => l.name && l.qty > 0);
    if (!items.length) return toast.error("Add at least one item");
    const { error } = await supabase.rpc("complete_purchase", {
      payload: {
        supplier_id: supplier === "none" ? null : supplier,
        tax, paid, note,
        items: items.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty, cost: l.cost })),
      },
    });
    if (error) return toast.error(error.message);
    toast.success("Purchase recorded, stock updated");
    setOpen(false); setLines([]); setSupplier("none"); setTax(0); setPaid(0); setNote("");
    qc.invalidateQueries({ queryKey: ["purchases"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Purchases</h1>
          <p className="text-sm text-muted-foreground">Record stock received from suppliers</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New purchase</Button></DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>New purchase</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Supplier</Label>
                  <Select value={supplier} onValueChange={setSupplier}>
                    <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
              </div>

              <div className="border rounded-md">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Product</TableHead><TableHead>Name</TableHead>
                    <TableHead className="w-24">Qty</TableHead><TableHead className="w-28">Cost</TableHead>
                    <TableHead className="w-28 text-right">Old Avg</TableHead>
                    <TableHead className="w-28 text-right">New Avg</TableHead>
                    <TableHead className="w-20 text-right">Δ%</TableHead>
                    <TableHead className="text-right w-28">Total</TableHead><TableHead className="w-10"></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {lines.map((l, i) => {
                      const oldStock = Number(l.old_stock ?? 0);
                      const oldCost = Number(l.old_cost ?? 0);
                      const qty = Number(l.qty || 0);
                      const cost = Number(l.cost || 0);
                      const hasProduct = !!l.product_id;
                      const newAvg = hasProduct
                        ? (oldStock > 0 ? (oldStock * oldCost + qty * cost) / (oldStock + qty) : cost)
                        : cost;
                      const delta = hasProduct && oldCost > 0 ? ((newAvg - oldCost) / oldCost) * 100 : 0;
                      const deltaClass = delta > 0 ? "text-destructive" : delta < 0 ? "text-emerald-600" : "text-muted-foreground";
                      return (
                      <TableRow key={i}>
                        <TableCell>
                          <Select
                            value={l.product_id ?? "new"}
                            onValueChange={(v) => {
                              if (v === "new") { setLine(i, { product_id: null, old_stock: 0, old_cost: 0 }); return; }
                              const p = products.find((p) => p.id === v);
                              setLine(i, { product_id: v, name: p?.name ?? "", cost: Number(p?.cost_price ?? 0), old_stock: Number(p?.stock ?? 0), old_cost: Number(p?.cost_price ?? 0) });
                            }}
                          >
                            <SelectTrigger className="h-8"><SelectValue placeholder="Pick…" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="new">— New / ad-hoc —</SelectItem>
                              {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} className="h-8" /></TableCell>
                        <TableCell><Input type="number" step="0.001" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} className="h-8" /></TableCell>
                        <TableCell><Input type="number" step="0.01" value={l.cost} onChange={(e) => setLine(i, { cost: Number(e.target.value) })} className="h-8" /></TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {hasProduct ? <>{fmtMoney(oldCost, sym)}<div className="text-[10px]">stock {oldStock}</div></> : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium">
                          {hasProduct ? fmtMoney(newAvg, sym) : "—"}
                        </TableCell>
                        <TableCell className={`text-right text-xs font-semibold ${deltaClass}`}>
                          {hasProduct && oldCost > 0 ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium">{fmtMoney(qty * cost, sym)}</TableCell>
                        <TableCell><Button variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, x) => x !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <div className="p-2"><Button variant="outline" size="sm" onClick={addLine}><Plus className="h-3.5 w-3.5 mr-1" />Add row</Button></div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div><Label>Tax</Label><Input type="number" step="0.01" value={tax} onChange={(e) => setTax(Number(e.target.value))} /></div>
                <div><Label>Paid</Label><Input type="number" step="0.01" value={paid} onChange={(e) => setPaid(Number(e.target.value))} /></div>
                <div className="flex flex-col justify-end">
                  <div className="text-sm text-muted-foreground">Total</div>
                  <div className="text-2xl font-semibold text-primary">{fmtMoney(total, sym)}</div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit}>Record purchase</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-3">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead>
            <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {purchases.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No purchases yet</TableCell></TableRow>}
            {purchases.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.invoice_no}</TableCell>
                <TableCell className="text-sm">{new Date(p.created_at).toLocaleString()}</TableCell>
                <TableCell>{p.suppliers?.name ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">{fmtMoney(p.total, sym)}</TableCell>
                <TableCell className="text-right">{fmtMoney(p.paid, sym)}</TableCell>
                <TableCell><span className="text-xs">{p.status}</span></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
