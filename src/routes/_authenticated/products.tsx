import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, History, Package } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
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
import { fetchAll } from "@/lib/supabase-page";


export const Route = createFileRoute("/_authenticated/products")({
  component: ProductsPage,
});

type ProductForm = {
  id?: string; name: string; sku: string; barcode: string; barcodes_text: string; category: string; unit: string;
  cost_price: number; sell_price: number; stock: number; tax_rate: number; is_active: boolean; low_stock_threshold: number;
};
const empty: ProductForm = { name: "", sku: "", barcode: "", barcodes_text: "", category: "", unit: "pcs", cost_price: 0, sell_price: 0, stock: 0, tax_rate: 0, is_active: true, low_stock_threshold: 5 };

function ProductsPage() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: priceVisibility } = usePriceVisibility();
  const sym = settings?.currency_symbol ?? "Rs";
  const showCost = priceVisibility?.showCost ?? true;
  const showSell = priceVisibility?.showSell ?? true;
  const tableColCount = 5 + (showCost ? 1 : 0) + (showSell ? 1 : 0);
  const [search, setSearch] = useState("");
  const [open, setOpen, clearOpen] = usePersistentState<boolean>("product-entry-open", false);
  const [form, setForm, clearForm] = usePersistentState<ProductForm>("product-entry-form", empty);


  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () =>
      fetchAll<any>((from, to) =>
        supabase.from("products").select("*").order("name").range(from, to),
      ),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q),
    );
  }, [products, search]);

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE),
    [filtered, pageSafe],
  );

  const parseBarcodes = (text: string) =>
    Array.from(new Set(text.split(/[\s,;\n]+/).map((s) => s.trim()).filter(Boolean)));

  const save = async () => {
    if (!form.name) return toast.error("Name is required");
    const allBarcodes = parseBarcodes(form.barcodes_text);
    const primary = form.barcode?.trim() || allBarcodes[0] || null;
    if (!primary) return toast.error("Barcode is required");
    const { barcodes_text: _bt, stock: newStock, ...rest } = form;
    const payload = { ...rest, sku: form.sku || null, barcode: primary, category: form.category || null };
    let productId = form.id;
    if (form.id) {
      // Update all non-stock fields directly
      const { error } = await supabase.from("products").update(payload).eq("id", form.id);
      if (error) return toast.error(error.message);
      // Route stock changes through the adjustment RPC so a movement is recorded
      const existing = products.find((p) => p.id === form.id);
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

    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product_barcodes"] });
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["products"] });
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
    });
    setOpen(true);
  };


  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Products"
        description={`${products.length} items in catalog`}
        icon={<Package className="h-5 w-5" />}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />New product</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{form.id ? "Edit" : "New"} product</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
                <div><Label>Primary barcode <span className="text-destructive">*</span></Label><Input required value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></div>
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
                {showSell && <div><Label>Price</Label><Input type="number" step="0.01" value={form.sell_price} onChange={(e) => setForm({ ...form, sell_price: Number(e.target.value) })} /></div>}
                <div><Label>Stock</Label><Input type="number" step="0.001" value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} /></div>
                <div><Label>Low-stock alert at</Label><Input type="number" step="0.001" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) })} /></div>
                <div><Label>Tax %</Label><Input type="number" step="0.01" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })} /></div>
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
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name, SKU, barcode…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Category</TableHead>
              {showCost && <TableHead className="text-right">Cost</TableHead>}
              {showSell && <TableHead className="text-right">Price</TableHead>}
              <TableHead className="text-right">Stock</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={tableColCount} className="py-4"><TableSkeleton rows={5} columns={tableColCount} /></TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={tableColCount} className="py-8">
                <EmptyState icon={Package} title="No products yet" description="Add a new product to start selling." />
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
        {!isLoading && filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-3 text-sm">
            <div className="text-muted-foreground">
              Showing {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtered.length)} of {filtered.length}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)}>Prev</Button>
              <span className="px-2 py-1">Page {pageSafe} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={pageSafe >= totalPages} onClick={() => setPage(pageSafe + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
