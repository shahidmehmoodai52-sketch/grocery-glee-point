import { createFileRoute } from "@tanstack/react-router";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty, CommandGroup } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { fetchAll } from "@/lib/supabase-page";
import { offlineFirst, cacheProducts, cacheSuppliers, cachePurchases } from "@/lib/offline/pos";
import { db } from "@/lib/offline/db";

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

  const [search, setSearch] = useState("");


  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => offlineFirst<any[]>(
      async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
      async () => (await db().suppliers.orderBy("name").toArray()).map((s: any) => ({ id: s.id, name: s.name })),
      cacheSuppliers,
    ),
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => offlineFirst<any[]>(
      async () => fetchAll<any>((from, to) => supabase.from("products").select("id,name,barcode,cost_price,stock").order("name").range(from, to)),
      async () => (await db().products.orderBy("name").toArray()).map((p: any) => ({ id: p.id, name: p.name, barcode: p.barcode, cost_price: p.cost_price, stock: p.stock })),
      cacheProducts,
    ),
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases"],
    queryFn: async () => offlineFirst<any[]>(
      async () => (await supabase.from("purchases").select("*, suppliers(name)").order("created_at", { ascending: false }).limit(100)).data ?? [],
      async () => {
        const rows = await db().purchases.orderBy("created_at").reverse().limit(100).toArray();
        const supMap = new Map((await db().suppliers.toArray()).map((s: any) => [s.id, s.name]));
        return rows.map((r: any) => ({ ...r, suppliers: r.supplier_id ? { name: supMap.get(r.supplier_id) ?? null } : null }));
      },
      cachePurchases,
    ),
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
    clearDraft();
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
                <div>
                  <Label>Search &amp; add product</Label>
                  <ProductPicker
                    products={products}
                    value={null}
                    placeholder="Search name or barcode to add…"
                    onPick={(p) => {
                      if (!p) {
                        setLines((ls) => [...ls, { product_id: null, name: "", qty: 1, cost: 0 }]);
                        return;
                      }
                      setLines((ls) => [
                        ...ls,
                        {
                          product_id: p.id,
                          name: p.name ?? "",
                          qty: 1,
                          cost: Number(p.cost_price ?? 0),
                          old_stock: Number(p.stock ?? 0),
                          old_cost: Number(p.cost_price ?? 0),
                        },
                      ]);
                    }}
                  />
                </div>
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
                          <ProductPicker
                            products={products}
                            value={l.product_id}
                            onPick={(p) => {
                              if (!p) { setLine(i, { product_id: null, old_stock: 0, old_cost: 0 }); return; }
                              setLine(i, { product_id: p.id, name: p.name ?? "", cost: Number(p.cost_price ?? 0), old_stock: Number(p.stock ?? 0), old_cost: Number(p.cost_price ?? 0) });
                            }}
                          />
                        </TableCell>
                        <TableCell><Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} className="h-8" /></TableCell>
                        <TableCell><Input type="number" step="0.001" value={l.qty} onChange={(e) => {
                          const v = Number(e.target.value);
                          setLines((ls) => {
                            const next = ls.map((row, idx) => idx === i ? { ...row, qty: v } : row);
                            if (v > 0 && i === ls.length - 1) next.push({ product_id: null, name: "", qty: 1, cost: 0 });
                            return next;
                          });
                        }} className="h-8" /></TableCell>
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
                <div className="p-2"></div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div><Label>Tax</Label><Input type="number" step="0.01" value={tax} onChange={(e) => setTax(Number(e.target.value))} /></div>
                <div><Label>Paid</Label><Input type="number" step="0.01" value={paid} onChange={(e) => setPaid(Number(e.target.value))} /></div>
                <div><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
                <div className="flex flex-col justify-end">
                  <div className="text-sm text-muted-foreground">Total</div>
                  <div className="text-2xl font-semibold text-primary">{fmtMoney(total, sym)}</div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Hide (keep draft)</Button>
              <Button variant="outline" onClick={clearDraft}>Discard</Button>
              <Button onClick={submit}>Record purchase</Button>
            </DialogFooter>

          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-3 space-y-3">
        <div className="relative max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search invoice, supplier, or note…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        {(() => {
          const q = search.trim().toLowerCase();
          const filtered = q
            ? (purchases as any[]).filter((p) =>
                (p.invoice_no ?? "").toLowerCase().includes(q) ||
                (p.suppliers?.name ?? "").toLowerCase().includes(q) ||
                (p.note ?? "").toLowerCase().includes(q))
            : (purchases as any[]);
          return (
        <Table>
          <TableHeader><TableRow>
            <TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead>
            <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">{q ? "No matching purchases" : "No purchases yet"}</TableCell></TableRow>}
            {filtered.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.invoice_no}</TableCell>
                <TableCell className="text-sm">{new Date(p.created_at).toLocaleString()}</TableCell>
                <TableCell>{p.suppliers?.name ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">{fmtMoney(p.total, sym)}</TableCell>
                <TableCell className="text-right">{fmtMoney(p.paid, sym)}</TableCell>
                <TableCell><span className="text-xs">{p.status}</span></TableCell>
              </TableRow>
            ))}
            {filtered.length > 0 && (() => {
              const allTotal = filtered.reduce((s: number, p: any) => s + Number(p.total), 0);
              const allPaid = filtered.reduce((s: number, p: any) => s + Number(p.paid), 0);
              const due = allTotal - allPaid;
              return (
                <>
                  <TableRow className="bg-muted/40 font-semibold border-t-2">
                    <TableCell colSpan={3} className="text-right">Column totals</TableCell>
                    <TableCell className="text-right text-primary">{fmtMoney(allTotal, sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(allPaid, sym)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                  <TableRow className="bg-primary/5 font-bold">
                    <TableCell colSpan={5} className="text-right text-base">Grand Total (Outstanding due)</TableCell>
                    <TableCell className={`text-right text-base ${due > 0 ? "text-destructive" : "text-success"}`}>{fmtMoney(due, sym)}</TableCell>
                  </TableRow>
                </>
              );
            })()}
          </TableBody>
        </Table>
          );
        })()}
        {(() => {
          const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
          const todayTotal = (purchases as any[]).filter((p) => new Date(p.created_at) >= startOfToday).reduce((s, p) => s + Number(p.total), 0);
          const todayPaid = (purchases as any[]).filter((p) => new Date(p.created_at) >= startOfToday).reduce((s, p) => s + Number(p.paid), 0);
          return (
            <div className="flex flex-wrap gap-6 justify-end border-t mt-2 pt-3 px-2 text-sm">
              <div><span className="text-muted-foreground">Today's purchases: </span><span className="font-semibold text-primary">{fmtMoney(todayTotal, sym)}</span></div>
              <div><span className="text-muted-foreground">Today's paid: </span><span className="font-semibold">{fmtMoney(todayPaid, sym)}</span></div>
            </div>
          );
        })()}
      </Card>
    </div>
  );
}

type PickerProduct = { id: string; name: string; barcode?: string | null; cost_price?: number | null; stock?: number | null };

function ProductPicker({ products, value, onPick, placeholder }: { products: PickerProduct[]; value: string | null; onPick: (p: PickerProduct | null) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = value ? products.find((p) => p.id === value) : null;
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return products.slice(0, 50);
    return products.filter((p) =>
      (p.name ?? "").toLowerCase().includes(term) ||
      (p.barcode ?? "").toLowerCase().includes(term)
    ).slice(0, 50);
  }, [products, q]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" role="combobox" className="h-9 w-full justify-between font-normal">
          <span className="truncate">{selected ? selected.name : (placeholder ?? "Pick / ad-hoc")}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[320px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search name or barcode…" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>No product found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__new" onSelect={() => { onPick(null); setOpen(false); setQ(""); }}>
                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                — New / ad-hoc —
              </CommandItem>
              {filtered.map((p) => (
                <CommandItem key={p.id} value={p.id} onSelect={() => { onPick(p); setOpen(false); setQ(""); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{p.name}</div>
                    {p.barcode && <div className="text-[10px] text-muted-foreground truncate">{p.barcode}</div>}
                  </div>
                  <span className="text-[10px] text-muted-foreground ml-2">stk {Number(p.stock ?? 0)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

