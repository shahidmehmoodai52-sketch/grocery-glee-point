import { createFileRoute } from "@tanstack/react-router";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Search, Pencil } from "lucide-react";
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
  const sym = settings?.currency_symbol ?? "Rs";

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entrySearch, setEntrySearch] = useState("");
  const [entryActive, setEntryActive] = useState(false);
  const [entryIndex, setEntryIndex] = useState(0);
  const [editRow, setEditRow] = useState<any | null>(null);
  const [editItems, setEditItems] = useState<any[]>([]);
  const [editItemsOriginal, setEditItemsOriginal] = useState<any[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const openEdit = async (p: any) => {
    setEditRow({ ...p, supplier_id: p.supplier_id ?? "none" });
    setEditItems([]);
    setEditItemsOriginal([]);
    setEditLoading(true);
    const { data, error } = await supabase
      .from("purchase_items")
      .select("id,product_id,name,qty,cost,line_total")
      .eq("purchase_id", p.id);
    setEditLoading(false);
    if (error) { toast.error(error.message); return; }
    const rows = (data ?? []).map((r: any) => ({ ...r, qty: Number(r.qty), cost: Number(r.cost) }));
    setEditItems(rows);
    setEditItemsOriginal(rows.map((r) => ({ ...r })));
  };
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
    const prods = products as PickerProduct[];
    // 1) exact match on primary barcode
    let exact = prods.find((p) => (p.barcode ?? "").toLowerCase() === t);
    // 2) exact match on extra barcodes (product_barcodes table)
    if (!exact) {
      const bcRow = (extraBarcodes as { product_id: string; barcode: string }[])
        .find((b) => (b.barcode ?? "").toLowerCase() === t);
      if (bcRow) exact = prods.find((p) => p.id === bcRow.product_id);
    }
    // 3) exact match on SKU/name
    if (!exact) exact = prods.find((p) => (p.name ?? "").toLowerCase() === t);
    // If the term looks like a code (digits) but has no exact match, treat as new item
    // instead of silently picking an unrelated substring match.
    const looksLikeCode = /^\d+$/.test(term);
    const match = exact || (looksLikeCode ? null : entryMatches[Math.min(entryIndex, Math.max(entryMatches.length - 1, 0))]);
    addProductLine(match ?? null, term);
  };




  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    staleTime: 60_000,
    queryFn: async () => offlineFirst<any[]>(
      async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
      async () => (await db().suppliers.orderBy("name").toArray()).map((s: any) => ({ id: s.id, name: s.name })),
      cacheSuppliers,
    ),
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    staleTime: 60_000,
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
    staleTime: 30_000,
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
    setSaving(true);
    const { error } = await supabase.rpc("complete_purchase", {
      payload: {
        supplier_id: supplier === "none" ? null : supplier,
        tax, paid, note,
        items: items.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty, cost: l.cost })),
      },
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Purchase recorded, stock updated");
    setConfirmOpen(false);
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
          <DialogContent className="w-[98vw] max-w-[1400px] h-[95vh] p-0 flex flex-col gap-0">
            <DialogHeader className="px-6 py-2 border-b shrink-0">
              <DialogTitle>New purchase</DialogTitle>
            </DialogHeader>

            {/* Top bar: supplier + big scan/search — POS style */}
            <div className="px-6 py-2 border-b bg-muted/30 shrink-0">
              <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 items-end">
                <div>
                  <Label className="text-xs">Supplier</Label>
                  <Select value={supplier} onValueChange={(v) => { setSupplier(v); focusSearch(); }}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Scan or search product</Label>
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      ref={searchRef}
                      value={entrySearch}
                      onFocus={() => setEntryActive(true)}
                      onBlur={() => setTimeout(() => setEntryActive(false), 120)}
                      onChange={(e) => { setEntrySearch(e.target.value); setEntryActive(true); setEntryIndex(0); }}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") { e.preventDefault(); setEntryIndex((n) => Math.min(n + 1, Math.max(entryMatches.length - 1, 0))); }
                        if (e.key === "ArrowUp") { e.preventDefault(); setEntryIndex((n) => Math.max(n - 1, 0)); }
                        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); addFromSearch(); }
                      }}
                      placeholder="🔍  Scan barcode or type name, press Enter to add…"
                      className="pl-10 h-9 text-sm"
                      autoFocus
                    />
                    {entryActive && entrySearch.trim() && (
                      <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 shadow-lg">
                        {entryMatches.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">No stock item found. Press Enter to add as new item.</div>
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
            </div>

            {/* Selected items — takes all available space */}
            <div className="flex-1 min-h-0 flex flex-col px-6 py-2 overflow-hidden">
              <div className="flex items-center justify-between mb-1 shrink-0">
                <div className="text-sm">
                  <span className="font-semibold">{lines.length}</span>
                  <span className="text-muted-foreground"> item{lines.length === 1 ? "" : "s"}</span>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => { addProductLine(null, ""); }} className="h-7">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add empty row
                </Button>
              </div>

              <div className="flex-1 min-h-0 border rounded-md overflow-auto">
                {lines.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
                    <Search className="h-10 w-10 mb-3 opacity-40" />
                    <p className="text-sm font-medium">No items added yet</p>
                    <p className="text-xs mt-1">Scan a barcode or type a product name above, then press Enter.</p>
                  </div>
                ) : (
                  <Table className="min-w-[900px] [&_td]:py-1 [&_th]:py-1.5 [&_th]:h-8">
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="w-[170px]">Product</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="w-[130px]">Cost</TableHead>
                        <TableHead className="w-[110px]">Qty</TableHead>
                        <TableHead className="w-20 text-right">Old Avg</TableHead>
                        <TableHead className="w-20 text-right">New Avg</TableHead>
                        <TableHead className="w-14 text-right">Δ%</TableHead>
                        <TableHead className="text-right w-[110px]">Total</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
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
                              <div className="min-w-0 leading-tight">
                                <div className="truncate text-xs font-medium">{l.barcode || (hasProduct ? "Stock item" : "New item")}</div>
                                <div className="truncate text-[10px] text-muted-foreground">stock {oldStock}</div>
                              </div>
                            </TableCell>
                            <TableCell><Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} className="h-8 text-sm" /></TableCell>
                            <TableCell>
                              <Input
                                id={`purchase-cost-${i}`}
                                type="number"
                                step="0.01"
                                value={l.cost}
                                onChange={(e) => setLine(i, { cost: Number(e.target.value) })}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); focusCell("qty", i); } }}
                                className="h-8 text-right text-sm"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                id={`purchase-qty-${i}`}
                                type="number"
                                step="0.001"
                                value={l.qty}
                                onChange={(e) => setLine(i, { qty: Number(e.target.value) })}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); focusSearch(); } }}
                                className="h-8 text-right text-sm"
                              />
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {hasProduct ? fmtMoney(oldCost, sym) : "—"}
                            </TableCell>
                            <TableCell className="text-right text-xs font-medium">
                              {hasProduct ? fmtMoney(newAvg, sym) : "—"}
                            </TableCell>
                            <TableCell className={`text-right text-xs font-semibold ${deltaClass}`}>
                              {hasProduct && oldCost > 0 ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%` : "—"}
                            </TableCell>
                            <TableCell className="text-right font-medium text-sm">{fmtMoney(qty * cost, sym)}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLines(lines.filter((_, x) => x !== i))}>
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>

              {/* Totals strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 pt-2 shrink-0">
                <div><Label className="text-xs">Tax</Label><Input type="number" step="0.01" value={tax || ""} onChange={(e) => setTax(Number(e.target.value))} className="h-8" /></div>
                <div><Label className="text-xs">Paid</Label><Input type="number" step="0.01" value={paid || ""} onChange={(e) => setPaid(Number(e.target.value))} className="h-8" /></div>
                <div><Label className="text-xs">Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} className="h-8" /></div>
                <div className="flex flex-col justify-end rounded-md border bg-primary/5 px-3 py-1">
                  <div className="text-[10px] text-muted-foreground leading-none">Total</div>
                  <div className="text-xl font-bold text-primary leading-tight">{fmtMoney(total, sym)}</div>
                </div>
              </div>
            </div>

            <DialogFooter className="border-t bg-background px-6 py-2 shrink-0 sm:flex-row sm:justify-between gap-2">
              <div className="text-sm text-muted-foreground">
                {lines.length} item{lines.length === 1 ? "" : "s"} • Total <span className="font-semibold text-foreground">{fmtMoney(total, sym)}</span>
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Hide (keep draft)</Button>
                <Button variant="outline" size="sm" onClick={clearDraft}>Discard</Button>
                <Button onClick={() => setConfirmOpen(true)} disabled={lines.length === 0}>Record purchase</Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={confirmOpen} onOpenChange={(v) => { if (!saving) setConfirmOpen(v); }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Confirm purchase</DialogTitle></DialogHeader>
            <div className="space-y-2 text-sm">
              <p>Save this purchase with <b>{lines.length}</b> item{lines.length === 1 ? "" : "s"}?</p>
              <p className="text-muted-foreground">Total: <span className="font-semibold text-foreground">{fmtMoney(total, sym)}</span></p>
              <p className="text-xs text-muted-foreground">Stock and costs will be updated. This cannot be undone.</p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>Keep editing</Button>
              <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Yes, save purchase"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editRow} onOpenChange={(v) => { if (!editSaving && !v) { setEditRow(null); setEditItems([]); setEditItemsOriginal([]); } }}>
          <DialogContent className="w-[96vw] max-w-5xl max-h-[92vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit purchase {editRow?.invoice_no}</DialogTitle></DialogHeader>
            {editRow && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Invoice #</Label>
                    <Input value={editRow.invoice_no ?? ""} onChange={(e) => setEditRow({ ...editRow, invoice_no: e.target.value })} />
                  </div>
                  <div>
                    <Label>Supplier</Label>
                    <Select value={editRow.supplier_id ?? "none"} onValueChange={(v) => setEditRow({ ...editRow, supplier_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="border rounded-md overflow-x-auto">
                  <Table className="min-w-[720px]">
                    <TableHeader><TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="w-[150px]">Cost</TableHead>
                      <TableHead className="w-[140px]">Qty</TableHead>
                      <TableHead className="text-right w-[120px]">Total</TableHead>
                      <TableHead className="w-11"></TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {editLoading && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-sm">Loading items…</TableCell></TableRow>}
                      {!editLoading && editItems.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-sm">No items on this invoice</TableCell></TableRow>}
                      {editItems.map((it, i) => (
                        <TableRow key={it.id ?? `new-${i}`}>
                          <TableCell><Input value={it.name ?? ""} onChange={(e) => setEditItems((xs) => xs.map((r, x) => x === i ? { ...r, name: e.target.value } : r))} className="h-9" /></TableCell>
                          <TableCell><Input type="number" step="0.01" value={it.cost} onChange={(e) => setEditItems((xs) => xs.map((r, x) => x === i ? { ...r, cost: Number(e.target.value) } : r))} className="h-9 text-right" /></TableCell>
                          <TableCell><Input type="number" step="0.001" value={it.qty} onChange={(e) => setEditItems((xs) => xs.map((r, x) => x === i ? { ...r, qty: Number(e.target.value) } : r))} className="h-9 text-right" /></TableCell>
                          <TableCell className="text-right font-medium">{fmtMoney(Number(it.qty || 0) * Number(it.cost || 0), sym)}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => setEditItems((xs) => xs.filter((_, x) => x !== i))}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  <div><Label>Tax</Label><Input type="number" step="0.01" value={editRow.tax ?? 0} onChange={(e) => setEditRow({ ...editRow, tax: Number(e.target.value) })} /></div>
                  <div><Label>Paid</Label><Input type="number" step="0.01" value={editRow.paid ?? 0} onChange={(e) => setEditRow({ ...editRow, paid: Number(e.target.value) })} /></div>
                  <div>
                    <Label>Status</Label>
                    <Select value={editRow.status ?? "completed"} onValueChange={(v) => setEditRow({ ...editRow, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="completed">completed</SelectItem>
                        <SelectItem value="pending">pending</SelectItem>
                        <SelectItem value="cancelled">cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col justify-end">
                    <div className="text-sm text-muted-foreground">Total</div>
                    <div className="text-2xl font-semibold text-primary">
                      {fmtMoney(editItems.reduce((s, it) => s + Number(it.qty || 0) * Number(it.cost || 0), 0) + Number(editRow.tax || 0), sym)}
                    </div>
                  </div>
                </div>
                <div>
                  <Label>Note</Label>
                  <Input value={editRow.note ?? ""} onChange={(e) => setEditRow({ ...editRow, note: e.target.value })} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Changing item quantity adjusts product stock by the difference. Deleting an item removes its qty from stock. Cost changes update this invoice only (product average cost is not recalculated).
                </p>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setEditRow(null); setEditItems([]); setEditItemsOriginal([]); }} disabled={editSaving}>Cancel</Button>
              <Button
                disabled={editSaving || editLoading}
                onClick={async () => {
                  if (!editRow) return;
                  setEditSaving(true);
                  try {
                    const origById = new Map(editItemsOriginal.map((r) => [r.id, r]));
                    const keptIds = new Set(editItems.filter((r) => r.id).map((r) => r.id));

                    // 1) Stock deltas: kept items (new - old) + deleted items (0 - old)
                    const deltas = new Map<string, number>(); // product_id -> qty delta (positive = add stock)
                    for (const it of editItems) {
                      if (!it.product_id) continue;
                      const orig = it.id ? origById.get(it.id) : null;
                      const oldQty = orig ? Number(orig.qty) : 0;
                      const delta = Number(it.qty || 0) - oldQty;
                      if (delta !== 0) deltas.set(it.product_id, (deltas.get(it.product_id) ?? 0) + delta);
                    }
                    for (const orig of editItemsOriginal) {
                      if (!orig.product_id) continue;
                      if (keptIds.has(orig.id)) continue;
                      const delta = -Number(orig.qty);
                      if (delta !== 0) deltas.set(orig.product_id, (deltas.get(orig.product_id) ?? 0) + delta);
                    }

                    // Apply stock deltas
                    if (deltas.size) {
                      const ids = Array.from(deltas.keys());
                      const { data: prods, error: pErr } = await supabase.from("products").select("id,stock").in("id", ids);
                      if (pErr) throw pErr;
                      for (const p of prods ?? []) {
                        const newStock = Number(p.stock ?? 0) + (deltas.get(p.id) ?? 0);
                        const { error: uErr } = await supabase.from("products").update({ stock: newStock }).eq("id", p.id);
                        if (uErr) throw uErr;
                      }
                    }

                    // 2) Delete removed items
                    const removedIds = editItemsOriginal.filter((r) => !keptIds.has(r.id)).map((r) => r.id);
                    if (removedIds.length) {
                      const { error: dErr } = await supabase.from("purchase_items").delete().in("id", removedIds);
                      if (dErr) throw dErr;
                    }

                    // 3) Update kept items where changed
                    for (const it of editItems) {
                      if (!it.id) continue;
                      const orig = origById.get(it.id);
                      if (!orig) continue;
                      if (orig.name === it.name && Number(orig.qty) === Number(it.qty) && Number(orig.cost) === Number(it.cost)) continue;
                      const line_total = Number(it.qty || 0) * Number(it.cost || 0);
                      const { error: iErr } = await supabase.from("purchase_items")
                        .update({ name: it.name, qty: Number(it.qty || 0), cost: Number(it.cost || 0), line_total })
                        .eq("id", it.id);
                      if (iErr) throw iErr;
                    }

                    // 4) Recompute purchase totals & update header
                    const subtotal = editItems.reduce((s, it) => s + Number(it.qty || 0) * Number(it.cost || 0), 0);
                    const newTax = Number(editRow.tax ?? 0);
                    const newTotal = subtotal + newTax;
                    const { error: hErr } = await supabase
                      .from("purchases")
                      .update({
                        invoice_no: editRow.invoice_no,
                        supplier_id: editRow.supplier_id === "none" ? null : editRow.supplier_id,
                        subtotal,
                        tax: newTax,
                        total: newTotal,
                        paid: Number(editRow.paid ?? 0),
                        note: editRow.note ?? null,
                        status: editRow.status ?? "completed",
                      })
                      .eq("id", editRow.id);
                    if (hErr) throw hErr;

                    toast.success("Purchase updated");
                    setEditRow(null);
                    setEditItems([]);
                    setEditItemsOriginal([]);
                    qc.invalidateQueries({ queryKey: ["purchases"] });
                    qc.invalidateQueries({ queryKey: ["products"] });
                  } catch (e: any) {
                    toast.error(e?.message ?? "Failed to update purchase");
                  } finally {
                    setEditSaving(false);
                  }
                }}
              >
                {editSaving ? "Saving…" : "Save changes"}
              </Button>
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
            <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead>Status</TableHead><TableHead className="w-16 text-right">Edit</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">{q ? "No matching purchases" : "No purchases yet"}</TableCell></TableRow>}
            {filtered.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.invoice_no}</TableCell>
                <TableCell className="text-sm">{new Date(p.created_at).toLocaleString()}</TableCell>
                <TableCell>{p.suppliers?.name ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">{fmtMoney(p.total, sym)}</TableCell>
                <TableCell className="text-right">{fmtMoney(p.paid, sym)}</TableCell>
                <TableCell><span className="text-xs">{p.status}</span></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TableCell>
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
                    <TableCell colSpan={2}></TableCell>
                  </TableRow>
                  <TableRow className="bg-primary/5 font-bold">
                    <TableCell colSpan={5} className="text-right text-base">Grand Total (Outstanding due)</TableCell>
                    <TableCell className={`text-right text-base ${due > 0 ? "text-destructive" : "text-success"}`}>{fmtMoney(due, sym)}</TableCell>
                    <TableCell></TableCell>
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

