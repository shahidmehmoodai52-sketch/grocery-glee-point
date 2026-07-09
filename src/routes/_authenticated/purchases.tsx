import { createFileRoute } from "@tanstack/react-router";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Search } from "lucide-react";
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
import { fetchAll } from "@/lib/supabase-page";
import { offlineFirst, cacheProducts, cacheSuppliers, cachePurchases } from "@/lib/offline/pos";
import { db } from "@/lib/offline/db";

export const Route = createFileRoute("/_authenticated/purchases")({ component: Page });

type Line = { product_id: string | null; name: string; qty: number; cost: number; old_stock?: number; old_cost?: number; barcode?: string | null };

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
  const [entrySearch, setEntrySearch] = useState("");
  const [entryActive, setEntryActive] = useState(false);
  const [entryIndex, setEntryIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusCell = (kind: "cost" | "qty", i: number) => {
    setTimeout(() => {
      const el = document.getElementById(`purchase-${kind}-${i}`) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 0);
  };
  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 0);
  const addProductLine = (product: PickerProduct | null, fallbackName?: string) => {
    let newIndex = 0;
    setLines((ls) => {
      newIndex = ls.length;
      if (product) {
        return [...ls, {
          product_id: product.id,
          name: product.name ?? "",
          qty: 1,
          cost: Number(product.cost_price ?? 0),
          old_stock: Number(product.stock ?? 0),
          old_cost: Number(product.cost_price ?? 0),
          barcode: product.barcode ?? null,
        }];
      }
      return [...ls, { product_id: null, name: fallbackName ?? "", qty: 1, cost: 0 }];
    });
    setEntrySearch("");
    setEntryActive(false);
    setEntryIndex(0);
    focusCell("cost", newIndex);
  };
  const addFromSearch = () => {
    const term = entrySearch.trim();
    if (!term) return;
    const t = term.toLowerCase();
    const exactBarcode = (products as PickerProduct[]).find((p) => (p.barcode ?? "").toLowerCase() === t);
    const match = exactBarcode || entryMatches[Math.min(entryIndex, Math.max(entryMatches.length - 1, 0))];
    addProductLine(match ?? null, term);
  };




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
  const entryMatches = useMemo(() => {
    const term = entrySearch.trim().toLowerCase();
    if (!term) return [] as PickerProduct[];
    return (products as PickerProduct[])
      .filter((p) =>
        (p.name ?? "").toLowerCase().includes(term) ||
        (p.barcode ?? "").toLowerCase().includes(term) ||
        String(p.stock ?? "").toLowerCase().includes(term)
      )
      .slice(0, 8);
  }, [entrySearch, products]);
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
          <DialogContent className="w-[96vw] max-w-6xl max-h-[92vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New purchase</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Supplier</Label>
                  <Select value={supplier} onValueChange={(v) => { setSupplier(v); focusSearch(); }}>
                    <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Search &amp; add product</Label>
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      ref={searchRef}
                      value={entrySearch}
                      onFocus={() => setEntryActive(true)}
                      onBlur={() => setTimeout(() => setEntryActive(false), 120)}
                      onChange={(e) => { setEntrySearch(e.target.value); setEntryActive(true); setEntryIndex(0); }}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setEntryIndex((n) => Math.min(n + 1, Math.max(entryMatches.length - 1, 0)));
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setEntryIndex((n) => Math.max(n - 1, 0));
                        }
                        if (e.key === "Enter") { e.preventDefault(); addFromSearch(); }
                      }}
                      placeholder="Scan barcode or type name, press Enter…"
                      className="pl-8 h-10"
                      autoFocus
                    />
                    {entryActive && entrySearch.trim() && (
                      <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
                        {entryMatches.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">No stock item found. Press Enter to add new item.</div>
                        ) : entryMatches.map((p, idx) => (
                          <button
                            key={p.id}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); addProductLine(p); }}
                            className={`flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm ${idx === entryIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground"}`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{p.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">{p.barcode || "No barcode"}</span>
                            </span>
                            <span className="shrink-0 text-right text-xs text-muted-foreground">
                              <span className="block">stock {Number(p.stock ?? 0)}</span>
                              <span className="block">{fmtMoney(Number(p.cost_price ?? 0), sym)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="border rounded-md overflow-x-auto">
                <Table className="min-w-[860px] table-fixed">
                  <TableHeader><TableRow>
                    <TableHead className="w-[180px]">Product</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[150px]">Cost</TableHead>
                    <TableHead className="w-[140px]">Qty</TableHead>
                    <TableHead className="hidden lg:table-cell w-28 text-right">Old Avg</TableHead>
                    <TableHead className="hidden lg:table-cell w-28 text-right">New Avg</TableHead>
                    <TableHead className="hidden lg:table-cell w-20 text-right">Δ%</TableHead>
                    <TableHead className="text-right w-[130px]">Total</TableHead><TableHead className="w-11"></TableHead>
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
                        <TableCell className="align-middle">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{l.barcode || (hasProduct ? "Stock item" : "New item")}</div>
                            <div className="truncate text-[11px] text-muted-foreground">stock {oldStock}</div>
                          </div>
                        </TableCell>
                        <TableCell><Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} className="h-10" /></TableCell>
                        <TableCell>
                          <Input
                            id={`purchase-cost-${i}`}
                            type="number"
                            step="0.01"
                            value={l.cost}
                            onChange={(e) => setLine(i, { cost: Number(e.target.value) })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); focusCell("qty", i); }
                            }}
                            className="h-10 text-right text-base"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            id={`purchase-qty-${i}`}
                            type="number"
                            step="0.001"
                            value={l.qty}
                            onChange={(e) => setLine(i, { qty: Number(e.target.value) })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); focusSearch(); }
                            }}
                            className="h-10 text-right text-base"
                          />
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-right text-xs text-muted-foreground">
                          {hasProduct ? <>{fmtMoney(oldCost, sym)}<div className="text-[10px]">stock {oldStock}</div></> : "—"}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-right text-xs font-medium">
                          {hasProduct ? fmtMoney(newAvg, sym) : "—"}
                        </TableCell>
                        <TableCell className={`hidden lg:table-cell text-right text-xs font-semibold ${deltaClass}`}>
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
                <div><Label>Tax</Label><Input type="number" step="0.01" value={tax || ""} onChange={(e) => setTax(Number(e.target.value))} /></div>
                <div><Label>Paid</Label><Input type="number" step="0.01" value={paid || ""} onChange={(e) => setPaid(Number(e.target.value))} /></div>
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

