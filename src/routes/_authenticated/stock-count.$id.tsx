import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  ArrowLeft, ScanLine, Search, CheckCircle2, XCircle,
  TrendingUp, TrendingDown, Equal, FileDown, Trash2, Ban, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney, fmtQty } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/stock-count/$id")({
  component: StockCountDetailPage,
});

type Item = {
  id: string;
  session_id: string;
  product_id: string;
  barcode: string | null;
  system_qty: number;
  actual_qty: number;
  reason: string | null;
  counter_id: string | null;
  counted_at: string;
};

type Product = {
  id: string; name: string; sku: string | null; barcode: string | null;
  stock: number; cost_price: number; unit: string | null;
};

function StockCountDetailPage() {
  const { id } = useParams({ from: "/_authenticated/stock-count/$id" });
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const scanMode: "prompt" | "increment" =
    (settings as any)?.stock_count_scan_mode === "increment" ? "increment" : "prompt";
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [pendingQty, setPendingQty] = useState<number>(1);
  const [filter, setFilter] = useState<"all" | "variance" | "missing" | "extra" | "match">("all");
  const scanRef = useRef<HTMLInputElement>(null);

  const sessionQ = useQuery({
    queryKey: ["stock-count-session", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_count_sessions" as any)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const itemsQ = useQuery({
    queryKey: ["stock-count-items", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_count_items" as any)
        .select("*")
        .eq("session_id", id)
        .order("counted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Item[];
    },
  });

  const productsQ = useQuery({
    queryKey: ["stock-count-products", id, itemsQ.data?.length ?? 0],
    enabled: !!itemsQ.data,
    queryFn: async () => {
      const ids = Array.from(new Set((itemsQ.data ?? []).map((i) => i.product_id)));
      if (ids.length === 0) return {} as Record<string, Product>;
      const { data, error } = await supabase
        .from("products")
        .select("id,name,sku,barcode,stock,cost_price,unit")
        .in("id", ids);
      if (error) throw error;
      const map: Record<string, Product> = {};
      for (const p of (data ?? []) as any[]) map[p.id] = p;
      return map;
    },
  });

  const productSearchQ = useQuery({
    queryKey: ["stock-count-product-search", productSearch],
    enabled: productSearch.trim().length >= 2,
    queryFn: async () => {
      const term = productSearch.trim();
      const { data, error } = await supabase
        .from("products")
        .select("id,name,sku,barcode,stock,cost_price,unit")
        .or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`)
        .limit(8);
      if (error) throw error;
      return (data ?? []) as Product[];
    },
    staleTime: 10_000,
  });

  const session = sessionQ.data;
  const isLocked = session?.status === "completed" || session?.status === "cancelled";
  const products = productsQ.data ?? {};
  const items = itemsQ.data ?? [];

  const rows = useMemo(() => {
    return items.map((it) => {
      const p = products[it.product_id];
      const diff = Number(it.actual_qty) - Number(it.system_qty);
      const varianceValue = diff * Number(p?.cost_price ?? 0);
      return { it, p, diff, varianceValue };
    });
  }, [items, products]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(({ it, p, diff }) => {
      if (filter === "variance" && diff === 0) return false;
      if (filter === "missing" && diff >= 0) return false;
      if (filter === "extra" && diff <= 0) return false;
      if (filter === "match" && diff !== 0) return false;
      if (!term) return true;
      const hay = `${p?.name ?? ""} ${p?.sku ?? ""} ${it.barcode ?? p?.barcode ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [rows, filter, search]);

  // Metrics
  const metrics = useMemo(() => {
    const missing = rows.filter((r) => r.diff < 0);
    const extra = rows.filter((r) => r.diff > 0);
    const match = rows.filter((r) => r.diff === 0);
    const totalVariance = rows.reduce((s, r) => s + r.varianceValue, 0);
    const sorted = [...rows].sort((a, b) => a.varianceValue - b.varianceValue);
    return {
      missingCount: missing.length,
      extraCount: extra.length,
      matchCount: match.length,
      totalVariance,
      largestLoss: sorted[0],
      largestGain: sorted[sorted.length - 1],
    };
  }, [rows]);

  const findProductByBarcode = async (code: string): Promise<Product | null> => {
    // Try primary barcode
    let { data } = await supabase
      .from("products")
      .select("id,name,sku,barcode,stock,cost_price,unit")
      .eq("barcode", code)
      .maybeSingle();
    if (data) return data as Product;
    // Try product_barcodes lookup
    const { data: bc } = await supabase
      .from("product_barcodes")
      .select("product_id")
      .eq("barcode", code)
      .maybeSingle();
    if (!bc) return null;
    const { data: p } = await supabase
      .from("products")
      .select("id,name,sku,barcode,stock,cost_price,unit")
      .eq("id", (bc as any).product_id)
      .maybeSingle();
    return (p as Product) ?? null;
  };

  const upsertCount = async (product: Product, qty: number, mode: "set" | "add") => {
    // Find existing row for this product in this session
    const existing = items.find((i) => i.product_id === product.id);
    if (existing) {
      const nextQty = mode === "set" ? qty : Number(existing.actual_qty) + qty;
      const { error } = await supabase
        .from("stock_count_items" as any)
        .update({ actual_qty: nextQty, counted_at: new Date().toISOString(), counter_id: user?.id })
        .eq("id", existing.id);
      if (error) return toast.error(error.message);
    } else {
      const nextQty = mode === "set" ? qty : qty;
      const { error } = await supabase
        .from("stock_count_items" as any)
        .insert({
          session_id: id,
          product_id: product.id,
          barcode: product.barcode,
          system_qty: Number(product.stock ?? 0),
          actual_qty: nextQty,
          counter_id: user?.id,
        });
      if (error) return toast.error(error.message);
    }
    qc.invalidateQueries({ queryKey: ["stock-count-items", id] });
  };

  const onScan = async () => {
    const code = scanValue.trim();
    if (!code || isLocked) return;
    const product = await findProductByBarcode(code);
    if (!product) {
      toast.error(`No product matches "${code}"`);
      return;
    }
    if (scanMode === "increment") {
      await upsertCount(product, 1, "add");
      toast.success(`+1 ${product.name}`);
      setScanValue("");
      scanRef.current?.focus();
    } else {
      setPendingBarcode(code);
      setPendingQty(1);
    }
  };

  const confirmPending = async () => {
    const product = pendingProduct ?? (pendingBarcode ? await findProductByBarcode(pendingBarcode) : null);
    if (!product) return;
    if (!Number.isFinite(pendingQty) || pendingQty < 0) return toast.error("Invalid quantity");
    await upsertCount(product, pendingQty, "set");
    toast.success(`Counted ${fmtQty(pendingQty)} × ${product.name}`);
    setPendingBarcode(null);
    setPendingProduct(null);
    setPendingQty(1);
    setScanValue("");
    scanRef.current?.focus();
  };

  const selectProductFromSearch = async (product: Product) => {
    if (scanMode === "increment") {
      await upsertCount(product, 1, "add");
      toast.success(`+1 ${product.name}`);
    } else {
      setPendingProduct(product);
      setPendingQty(1);
    }
    setProductSearch("");
    setScanValue("");
    scanRef.current?.focus();
  };

  const updateActual = async (item: Item, value: number) => {
    const { error } = await supabase
      .from("stock_count_items" as any)
      .update({ actual_qty: value, counted_at: new Date().toISOString(), counter_id: user?.id })
      .eq("id", item.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["stock-count-items", id] });
  };

  const removeItem = async (item: Item) => {
    const { error } = await supabase.from("stock_count_items" as any).delete().eq("id", item.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["stock-count-items", id] });
  };

  const cancelSession = async () => {
    const { error } = await supabase
      .from("stock_count_sessions" as any)
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Session cancelled");
    qc.invalidateQueries();
  };

  const approve = async () => {
    const { error } = await supabase.rpc("approve_stock_count_session" as any, { _session_id: id });
    if (error) return toast.error(error.message);
    toast.success("Stock count approved — inventory updated");
    qc.invalidateQueries();
  };

  const exportCsv = () => {
    const header = ["Product", "SKU", "Barcode", "System Qty", "Actual Qty", "Difference", "Unit Cost", "Variance Value", "Counter", "Counted At"];
    const lines = [header.join(",")];
    for (const r of rows) {
      const p = r.p;
      const line = [
        `"${(p?.name ?? "").replace(/"/g, '""')}"`,
        p?.sku ?? "",
        r.it.barcode ?? p?.barcode ?? "",
        r.it.system_qty,
        r.it.actual_qty,
        r.diff,
        p?.cost_price ?? 0,
        r.varianceValue.toFixed(2),
        r.it.counter_id ?? "",
        r.it.counted_at,
      ].join(",");
      lines.push(line);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-count-${session?.name ?? id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => window.print();

  if (sessionQ.isLoading) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }
  if (!session) {
    return (
      <div className="p-6">
        <Link to="/stock-count"><Button variant="ghost"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button></Link>
        <p className="mt-4 text-muted-foreground">Session not found.</p>
      </div>
    );
  }

  const statusMeta: Record<string, { label: string; classes: string }> = {
    draft: { label: "Draft", classes: "bg-muted text-muted-foreground" },
    in_progress: { label: "In Progress", classes: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
    completed: { label: "Approved", classes: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
    cancelled: { label: "Cancelled", classes: "bg-red-500/15 text-red-600 border-red-500/30" },
  };
  const sm = statusMeta[session.status] ?? statusMeta.draft;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/stock-count">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Sessions</Button>
        </Link>
      </div>

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{session.name}</h1>
            <Badge variant="outline" className={sm.classes}>{sm.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Started {format(new Date(session.started_at), "PPp")}
            {session.completed_at ? ` · completed ${format(new Date(session.completed_at), "PPp")}` : ""}
          </p>
          {session.notes && <p className="text-sm text-muted-foreground mt-1">{session.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv}><FileDown className="h-4 w-4 mr-1" /> CSV</Button>
          <Button variant="outline" onClick={printReport}>Print</Button>
          {!isLocked && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline"><Ban className="h-4 w-4 mr-1" /> Cancel</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this session?</AlertDialogTitle>
                  <AlertDialogDescription>
                    No inventory changes will be applied. This can't be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep counting</AlertDialogCancel>
                  <AlertDialogAction onClick={cancelSession}>Cancel session</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {!isLocked && isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button><ShieldCheck className="h-4 w-4 mr-1" /> Approve &amp; Apply</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Approve and apply adjustments?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will update {rows.filter((r) => r.diff !== 0).length} product stock levels
                    and record inventory movements. Session becomes read-only.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Not yet</AlertDialogCancel>
                  <AlertDialogAction onClick={approve}>Approve</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Variance Report */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Equal className="h-3.5 w-3.5" /> Perfect matches</div>
          <div className="text-2xl font-semibold mt-1">{metrics.matchCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5 text-red-600" /> Missing</div>
          <div className="text-2xl font-semibold mt-1 text-red-600">{metrics.missingCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> Extra</div>
          <div className="text-2xl font-semibold mt-1 text-emerald-600">{metrics.extraCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total variance value</div>
          <div className={`text-2xl font-semibold mt-1 ${metrics.totalVariance < 0 ? "text-red-600" : metrics.totalVariance > 0 ? "text-emerald-600" : ""}`}>
            {fmtMoney(metrics.totalVariance, sym)}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Largest loss / gain</div>
          <div className="text-sm font-medium mt-1 truncate">
            {metrics.largestLoss?.p?.name ?? "—"} · <span className="text-red-600">{fmtMoney(metrics.largestLoss?.varianceValue ?? 0, sym)}</span>
          </div>
          <div className="text-sm font-medium truncate">
            {metrics.largestGain?.p?.name ?? "—"} · <span className="text-emerald-600">{fmtMoney(metrics.largestGain?.varianceValue ?? 0, sym)}</span>
          </div>
        </Card>
      </div>

      {/* Scan + search */}
      {!isLocked && (
        <Card className="p-3">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
            <div>
              <Label className="text-xs">Scan or type barcode</Label>
              <div className="relative">
                <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={scanRef}
                  autoFocus
                  className="pl-9"
                  placeholder={scanMode === "increment" ? "Each scan adds +1" : "Scan then enter quantity"}
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onScan(); } }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Mode: <span className="font-medium">{scanMode === "increment" ? "Increment (+1 per scan)" : "Prompt for quantity"}</span> — change in Settings.
              </p>
            </div>
            <div className="hidden md:block h-10 border-l" />
            <div>
              <Label className="text-xs">Search product</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by name, SKU or barcode"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
              </div>
              {productSearch.trim().length >= 2 && (
                <div className="mt-2 rounded-md border bg-background p-2 space-y-1 max-h-48 overflow-auto">
                  {productSearchQ.isFetching && <div className="text-xs text-muted-foreground">Searching…</div>}
                  {!productSearchQ.isFetching && (productSearchQ.data ?? []).length === 0 && (
                    <div className="text-xs text-muted-foreground">No matching products</div>
                  )}
                  {(productSearchQ.data ?? []).map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => selectProductFromSearch(product)}
                    >
                      <span className="font-medium">{product.name}</span>
                      <span className="text-xs text-muted-foreground">{product.sku ?? product.barcode ?? "—"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All counted</SelectItem>
                <SelectItem value="variance">Variance only</SelectItem>
                <SelectItem value="missing">Missing (short)</SelectItem>
                <SelectItem value="extra">Extra (over)</SelectItem>
                <SelectItem value="match">Perfect match</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Filter counted list…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </Card>
      )}

      {/* Items table */}
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b flex items-center justify-between">
          <div className="font-medium">Counted items · {rows.length}</div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU / Barcode</TableHead>
                <TableHead className="text-right">System</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead className="text-right">Variance value</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemsQ.isLoading && (
                <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!itemsQ.isLoading && filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {rows.length === 0 ? "Scan a product to start counting." : "No items match this filter."}
                  </TableCell>
                </TableRow>
              )}
              {filteredRows.map(({ it, p, diff, varianceValue }) => (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{p?.name ?? "Unknown product"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {p?.sku ?? "—"}{p?.barcode ? ` · ${p.barcode}` : ""}
                  </TableCell>
                  <TableCell className="text-right">{fmtQty(it.system_qty)}</TableCell>
                  <TableCell className="text-right">
                    {isLocked ? (
                      fmtQty(it.actual_qty)
                    ) : (
                      <Input
                        type="number" step="0.001"
                        className="w-24 ml-auto text-right"
                        value={it.actual_qty}
                        onChange={(e) => updateActual(it, Number(e.target.value))}
                      />
                    )}
                  </TableCell>
                  <TableCell className={`text-right font-medium ${diff < 0 ? "text-red-600" : diff > 0 ? "text-emerald-600" : ""}`}>
                    {diff > 0 ? "+" : ""}{fmtQty(diff)}
                  </TableCell>
                  <TableCell className={`text-right ${varianceValue < 0 ? "text-red-600" : varianceValue > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {fmtMoney(varianceValue, sym)}
                  </TableCell>
                  <TableCell className="text-right">
                    {!isLocked && (
                      <Button variant="ghost" size="icon" onClick={() => removeItem(it)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Quantity prompt dialog */}
      <AlertDialog open={!!pendingBarcode || !!pendingProduct} onOpenChange={(o) => {
        if (!o) {
          setPendingBarcode(null);
          setPendingProduct(null);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enter actual quantity</AlertDialogTitle>
            <AlertDialogDescription>Barcode: {pendingBarcode}</AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label>Actual quantity on shelf</Label>
            <Input
              type="number" step="0.001" autoFocus
              value={pendingQty}
              onChange={(e) => setPendingQty(Number(e.target.value))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmPending(); } }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPending}>Save count</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
