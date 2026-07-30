import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, History, Package, ArrowUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { usePriceVisibility } from "@/hooks/use-price-visibility";
import { fmtMoney, fmtQty } from "@/lib/format";
import { usePersistentState } from "@/hooks/use-persistent-state";


export const Route = createFileRoute("/_authenticated/products")({
  component: ProductsPage,
});

type ProductForm = {
  id?: string; name: string; sku: string; barcode: string; barcodes_text: string; category: string; unit: string;
  cost_price: number; sell_price: number; stock: number; tax_rate: number; is_active: boolean; low_stock_threshold: number;
  preferred_supplier_id: string;
  batch_no: string; expiry_date: string; rack_location: string; allow_negative_stock: boolean;
};
const empty: ProductForm = { name: "", sku: "", barcode: "", barcodes_text: "", category: "", unit: "pcs", cost_price: 0, sell_price: 0, stock: 0, tax_rate: 0, is_active: true, low_stock_threshold: 5, preferred_supplier_id: "", batch_no: "", expiry_date: "", rack_location: "", allow_negative_stock: true };

const PAGE_SIZE = 50;

type SortKey = "name" | "sku" | "category" | "cost_price" | "sell_price" | "stock" | "created_at";
type StockFilter = "all" | "low" | "out" | "in";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Escape PostgREST `or()` filter separators inside a user-supplied term.
function safeTerm(q: string) {
  return q.replace(/[(),]/g, " ").trim();
}

function ProductsPage() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: priceVisibility } = usePriceVisibility();
  const sym = settings?.currency_symbol ?? "Rs";
  const showCost = priceVisibility?.showCost ?? true;
  const showSell = priceVisibility?.showSell ?? true;
  const tableColCount = 5 + (showCost ? 1 : 0) + (showSell ? 1 : 0);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search.trim(), 250);
  const [category, setCategory] = useState("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [open, setOpen, clearOpen] = usePersistentState<boolean>("product-entry-open", false);
  const [form, setForm, clearForm] = usePersistentState<ProductForm>("product-entry-form", empty);

  useEffect(() => { setPage(1); }, [debouncedSearch, category, stockFilter, sortKey, sortAsc]);

  // ---- Server-side paginated list ------------------------------------------
  // Never pull the whole catalogue: one page of rows + an exact count.
  const listKey = ["products", "list", { q: debouncedSearch, category, stockFilter, sortKey, sortAsc, page }] as const;
  const { data: listData, isLoading, isFetching } = useQuery({
    queryKey: listKey,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      let q = supabase
        .from("products")
        .select("*", { count: "exact" })
        .order(sortKey, { ascending: sortAsc, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      const term = safeTerm(debouncedSearch);
      if (term) {
        q = q.or(`name.ilike.%${term}%,sku.ilike.${term}%,barcode.ilike.${term}%`);
      }
      if (category !== "all") q = q.eq("category", category);
      if (stockFilter === "out") q = q.lte("stock", 0);
      if (stockFilter === "in") q = q.gt("stock", 0);
      if (stockFilter === "low") q = q.gt("stock", 0).lte("stock", 5);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as any[], total: count ?? 0 };
    },
  });
  const pageRows = listData?.rows ?? [];
  const total = listData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ---- Lightweight aggregates (counts only, no rows) ------------------------
  const { data: counts } = useQuery({
    queryKey: ["products", "counts"],
    staleTime: 30_000,
    queryFn: async () => {
      const [all, allowed] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("allow_negative_stock", true),
      ]);
      return { total: all.count ?? 0, allowed: allowed.count ?? 0 };
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["products", "categories"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("products").select("category").not("category", "is", null).limit(2000);
      return Array.from(new Set((data ?? []).map((r: any) => r.category).filter(Boolean))).sort() as string[];
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers", "products-form"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });

  const sortBtn = (key: SortKey) => () => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };
  const SortHead = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <TableHead className={className}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={sortBtn(k)}>
        {children}
        <ArrowUpDown className={`h-3 w-3 ${sortKey === k ? "opacity-100" : "opacity-30"}`} />
      </button>
    </TableHead>
  );

  const parseBarcodes = (text: string) =>
    Array.from(new Set(text.split(/[\s,;\n]+/).map((s) => s.trim()).filter(Boolean)));

  const invalidateProducts = () => qc.invalidateQueries({ queryKey: ["products"] });

  const save = async () => {
    if (!form.name) return toast.error("Name is required");
    const allBarcodes = parseBarcodes(form.barcodes_text);
    const primary = form.barcode?.trim() || allBarcodes[0] || null;
    const { barcodes_text: _bt, stock: newStock, ...rest } = form;
    const payload = { ...rest, sku: form.sku || null, barcode: primary || null, category: form.category || null, preferred_supplier_id: form.preferred_supplier_id || null, batch_no: form.batch_no || null, expiry_date: form.expiry_date || null, rack_location: form.rack_location || null, allow_negative_stock: form.allow_negative_stock };
    let productId = form.id;
    if (form.id) {
      // Update all non-stock fields directly
      const { error } = await supabase.from("products").update(payload).eq("id", form.id);
      if (error) return toast.error(error.message);
      // Route stock changes through the adjustment RPC so a movement is recorded.
      // Read the current stock from the server (the row may not be on this page).
      const { data: existing } = await supabase.from("products").select("stock").eq("id", form.id).maybeSingle();
      const oldStock = Number(existing?.stock ?? 0);
      if (Number(newStock) !== oldStock) {
        const { error: adjErr } = await supabase.rpc("adjust_product_stock", {
          _product_id: form.id,
          _new_stock: Number(newStock),
          _reason: "Manual adjustment",
          _note: undefined,
        });
        if (adjErr) return toast.error(adjErr.message);
      }
      productId = form.id;
    } else {
      const { data, error } = await supabase.from("products").insert({ ...payload, stock: newStock }).select("id").single();
      if (error) return toast.error(error.message);
      productId = data.id;
    }

    if (productId) {
      // Sync extra barcodes (all entries except the primary go into product_barcodes; primary also stored there for scan lookup)
      await supabase.from("product_barcodes").delete().eq("product_id", productId);
      const set = Array.from(new Set([...(primary ? [primary] : []), ...allBarcodes]));
      if (set.length > 0) {
        const rows = set.map((bc) => ({ product_id: productId!, barcode: bc }));
        const { error: bcErr } = await supabase.from("product_barcodes").insert(rows);
        if (bcErr) return toast.error(bcErr.message);
      }
    }
    toast.success(form.id ? "Product updated" : "Product added");
    clearOpen();
    clearForm();

    invalidateProducts();
    qc.invalidateQueries({ queryKey: ["product_barcodes"] });
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    invalidateProducts();
  };

  const edit = async (p: any) => {
    const { data: bcs } = await supabase.from("product_barcodes").select("barcode").eq("product_id", p.id);
    const list = (bcs ?? []).map((b: any) => b.barcode).filter((b: string) => b && b !== p.barcode);
    setForm({
      id: p.id, name: p.name, sku: p.sku ?? "", barcode: p.barcode ?? "",
      barcodes_text: list.join("\n"),
      category: p.category ?? "",
      unit: p.unit ?? "pcs", cost_price: Number(p.cost_price), sell_price: Number(p.sell_price),
      stock: Number(p.stock), tax_rate: Number(p.tax_rate), is_active: p.is_active,
      low_stock_threshold: Number(p.low_stock_threshold ?? 5),
      preferred_supplier_id: p.preferred_supplier_id ?? "",
      batch_no: p.batch_no ?? "",
      expiry_date: p.expiry_date ?? "",
      rack_location: p.rack_location ?? "",
      allow_negative_stock: !!p.allow_negative_stock,
    });
    setOpen(true);
  };

  const rangeLabel = useMemo(() => {
    if (total === 0) return "0";
    const start = (page - 1) * PAGE_SIZE + 1;
    return `${start}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()}`;
  }, [page, total]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Products"
        description={`${(counts?.total ?? total).toLocaleString()} items in catalog`}
        icon={<Package className="h-5 w-5" />}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />New product</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{form.id ? "Edit" : "New"} product</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="col-span-2">
                  <Label>Supplier</Label>
                  <Select value={form.preferred_supplier_id || "none"} onValueChange={(v) => setForm((prev) => ({ ...prev, preferred_supplier_id: v === "none" ? "" : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
                <div><Label>Primary barcode</Label><Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Optional" /></div>
                <div className="col-span-2">
                  <Label>Additional barcodes (one per line — for different versions/packs of the same item)</Label>
                  <textarea
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.barcodes_text}
                    onChange={(e) => setForm({ ...form, barcodes_text: e.target.value })}
                    placeholder={"8964000000001\n8964000000002"}
                  />
                </div>
                <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
                <div><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
                {showCost && <div><Label>Cost</Label><Input type="number" step="0.01" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) })} /></div>}
                {showSell && (
                  <div>
                    <Label className="flex items-center justify-between">
                      <span>Price</span>
                      {form.cost_price > 0 && form.sell_price > 0 && (
                        <span className={`text-xs ${form.sell_price >= form.cost_price ? "text-emerald-600" : "text-destructive"}`}>
                          {(((form.sell_price - form.cost_price) / form.cost_price) * 100).toFixed(1)}% margin
                        </span>
                      )}
                    </Label>
                    <Input type="number" step="0.01" value={form.sell_price} onChange={(e) => setForm({ ...form, sell_price: Number(e.target.value) })} />
                  </div>
                )}
                <div><Label>Stock</Label><Input type="number" step="0.001" value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} /></div>
                <div><Label>Low-stock alert at</Label><Input type="number" step="0.001" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) })} /></div>
                <div><Label>Tax %</Label><Input type="number" step="0.01" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })} /></div>
                <div><Label>Batch #</Label><Input value={form.batch_no} onChange={(e) => setForm({ ...form, batch_no: e.target.value })} placeholder="e.g. B-2026-01" /></div>
                <div><Label>Expiry date</Label><Input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></div>
                <div className="col-span-2"><Label>Rack / Shelf location</Label><Input value={form.rack_location} onChange={(e) => setForm({ ...form, rack_location: e.target.value })} placeholder="e.g. A-3, Shelf 2" /></div>
                <div className="col-span-2 flex items-start gap-2 rounded-md border p-3 bg-muted/30">
                  <input
                    id="allow-neg-stock"
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={form.allow_negative_stock}
                    onChange={(e) => setForm({ ...form, allow_negative_stock: e.target.checked })}
                  />
                  <label htmlFor="allow-neg-stock" className="text-sm cursor-pointer">
                    <div className="font-medium">Allow negative stock</div>
                    <div className="text-xs text-muted-foreground">
                      If checked, POS will keep selling this item even after stock is zero. If unchecked, POS blocks the sale when stock is insufficient.
                    </div>
                  </label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Hide (keep draft)</Button>
                <Button variant="outline" onClick={() => { clearOpen(); clearForm(); }}>Discard</Button>
                <Button onClick={save}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <Card className="p-3">
        <div className="mb-3 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by name, SKU, barcode…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as StockFilter)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stock</SelectItem>
              <SelectItem value="in">In stock</SelectItem>
              <SelectItem value="low">Low stock</SelectItem>
              <SelectItem value="out">Out of stock</SelectItem>
            </SelectContent>
          </Select>
          {(() => {
            const totalAll = counts?.total ?? 0;
            const allowedCount = counts?.allowed ?? 0;
            const allChecked = totalAll > 0 && allowedCount === totalAll;
            const someChecked = allowedCount > 0 && allowedCount < totalAll;
            return (
              <label className="flex items-start gap-2 rounded-md border p-2 px-3 bg-muted/30 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={async (e) => {
                    const next = e.target.checked;
                    if (!confirm(`${next ? "Enable" : "Disable"} negative stock for ALL ${totalAll} products?`)) return;
                    const { error } = await supabase
                      .from("products")
                      .update({ allow_negative_stock: next })
                      .not("id", "is", null);
                    if (error) return toast.error(error.message);
                    toast.success(`Negative stock ${next ? "enabled" : "disabled"} for all products`);
                    invalidateProducts();
                  }}
                />
                <span className="text-sm">
                  <div className="font-medium leading-tight">Allow negative stock (all products)</div>
                  <div className="text-xs text-muted-foreground">{allowedCount}/{totalAll} currently allow negative stock</div>
                </span>
              </label>
            );
          })()}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead k="name">Name</SortHead>
              <SortHead k="sku">SKU</SortHead>
              <SortHead k="category">Category</SortHead>
              {showCost && <SortHead k="cost_price" className="text-right">Cost</SortHead>}
              {showSell && <SortHead k="sell_price" className="text-right">Price</SortHead>}
              <SortHead k="stock" className="text-right">Stock</SortHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={tableColCount} className="py-4"><TableSkeleton rows={5} columns={tableColCount} /></TableCell></TableRow>
            )}
            {!isLoading && pageRows.length === 0 && (
              <TableRow><TableCell colSpan={tableColCount} className="py-8">
                <EmptyState icon={Package} title="No products found" description="Try a different search or filter, or add a new product." />
              </TableCell></TableRow>
            )}
            {pageRows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-muted-foreground">{p.sku ?? "—"}</TableCell>
                <TableCell>{p.category ?? "—"}</TableCell>
                {showCost && <TableCell className="text-right">{fmtMoney(p.cost_price, sym)}</TableCell>}
                {showSell && <TableCell className="text-right font-medium">{fmtMoney(p.sell_price, sym)}</TableCell>}
                <TableCell className="text-right">
                  {(() => {
                    const s = Number(p.stock);
                    const t = Number(p.low_stock_threshold ?? 5);
                    if (s <= 0) return <StatusBadge tone="danger">Out · {fmtQty(p.stock)} {p.unit}</StatusBadge>;
                    if (s <= t) return <StatusBadge tone="warning">Low · {fmtQty(p.stock)} {p.unit}</StatusBadge>;
                    return <StatusBadge tone="neutral">{fmtQty(p.stock)} {p.unit}</StatusBadge>;
                  })()}
                </TableCell>

                <TableCell className="text-right">
                  <Link to="/products/$id" params={{ id: p.id }}>
                    <Button variant="ghost" size="icon" title="Stock timeline"><History className="h-4 w-4" /></Button>
                  </Link>
                  <Button variant="ghost" size="icon" onClick={() => edit(p)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>

              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between mt-3 text-sm">
          <div className="text-muted-foreground">
            Showing {rangeLabel}{isFetching && !isLoading ? " · updating…" : ""}
          </div>
          <div className="flex gap-2 items-center">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
            <span className="px-2 py-1">Page {page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
