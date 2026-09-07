import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2, AlertTriangle, Plus, X, FileText, Barcode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { calculatePurchaseTotals } from "@/lib/purchase-totals";
import { QuickAddProductDialog, type QuickAddedProduct } from "@/components/quick-add-product-dialog";
import { extractPurchaseBill } from "./scan.functions";
import { fileToCompressedDataUrl } from "./image";
import { buildPreviewLine, matchSupplier } from "./matching";
import type { ExtractedBill, MatchedProductOption, MatchStatus, PreviewLine, SupplierMatch } from "./types";

type Stage = "idle" | "extracting" | "review" | "error";

const STATUS_LABEL: Record<MatchStatus, string> = {
  matched: "Matched",
  verify: "Please Verify",
  review: "Review Required",
  ambiguous: "Ambiguous — Review",
  unmatched: "Unmatched",
};
const STATUS_TONE: Record<MatchStatus, "success" | "warning" | "danger" | "neutral"> = {
  matched: "success",
  verify: "warning",
  review: "danger",
  ambiguous: "danger",
  unmatched: "neutral",
};

const RESOLVED_VIA_LABEL: Record<NonNullable<PreviewLine["resolvedVia"]>, string> = {
  scan: "✓ Found in your system (scanned)",
  search: "✓ Picked from your system",
  new: "+ New product",
};

/**
 * Same-line searchable product field: a plain text input (so free typing —
 * a name not in the catalogue — keeps working exactly as before) that also
 * opens a filtered, clickable list of this shop's own products on focus.
 * Classification (matched vs left as free text) happens on blur via
 * `onCommit`, never on every keystroke — changing that mid-type would keep
 * yanking focus away via the review screen's auto-advance-to-next-scan
 * effect.
 */
function ProductPicker({
  products,
  value,
  onTextChange,
  onCommit,
  onSelect,
  placeholder,
}: {
  products: MatchedProductOption[];
  value: string;
  onTextChange: (text: string) => void;
  onCommit: (text: string) => void;
  onSelect: (product: MatchedProductOption) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  // The filter query is deliberately its own state, separate from the
  // field's displayed `value` — that value starts out as the bill's raw
  // OCR text, which usually matches nothing in the catalogue, so filtering
  // by it immediately showed "No product found" the instant the row was
  // clicked. Opening the picker resets the query to empty (full list, or
  // top matches), and only live typing narrows it from there.
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const filtered = (term ? products.filter((p) => p.name.toLowerCase().includes(term)) : products).slice(0, 50);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <input
          className="w-full h-8 rounded border bg-background px-2 text-sm mt-0.5"
          value={value}
          placeholder={placeholder}
          onChange={(e) => { onTextChange(e.target.value); setSearch(e.target.value); setOpen(true); }}
          onFocus={() => { setSearch(""); setOpen(true); }}
          onBlur={(e) => { onCommit(e.target.value); setOpen(false); }}
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Keep the row's own text input focused — this popover is driven by
        // it, not by a separate CommandInput.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty>No product found.</CommandEmpty>
            <CommandGroup>
              {filtered.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onSelect={() => { onSelect(p); setOpen(false); }}
                >
                  <span className="truncate">{p.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export interface ImportedPurchase {
  supplierId: string | null;
  lines: {
    product_id: string | null;
    name: string;
    qty: number;
    cost: number;
    discount: number;
    barcode: string | null;
    item_code: string | null;
  }[];
  date: string | null;
  note: string;
  tax: number;
}

export function PurchaseBillScannerButton({
  suppliers,
  onImport,
}: {
  suppliers: { id: string; name: string }[];
  onImport: (result: ImportedPurchase) => void;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  // Pages picked so far for the bill currently being scanned — a bill can span
  // several photos or a multi-page PDF export, and picking again ADDS to this
  // list rather than replacing it, so earlier and newly-added pages both end
  // up in the same, single extraction.
  const [pages, setPages] = useState<File[]>([]);
  const [preview, setPreview] = useState<PreviewLine[]>([]);
  const [extracted, setExtracted] = useState<ExtractedBill | null>(null);
  const [products, setProducts] = useState<MatchedProductOption[]>([]);
  const [extraBarcodes, setExtraBarcodes] = useState<{ product_id: string; barcode: string }[]>([]);
  const [supplierMatch, setSupplierMatch] = useState<SupplierMatch | null>(null);
  const [supplierChoice, setSupplierChoice] = useState<string>("none");
  // "Not found in this shop's catalogue" flow: which line triggered it, and
  // what to prefill the shared Add-product dialog with.
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [newProductLineIdx, setNewProductLineIdx] = useState<number | null>(null);
  const [newProductPrefill, setNewProductPrefill] = useState<{ name?: string; barcode?: string }>({});
  const scanRefs = useRef<Array<HTMLInputElement | null>>([]);
  const lastAutoFocusedIdx = useRef<number | null>(null);
  const extract = useServerFn(extractPurchaseBill);

  const reset = () => {
    setStage("idle");
    setError("");
    setPages([]);
    setPreview([]);
    setExtracted(null);
    setProducts([]);
    setExtraBarcodes([]);
    setSupplierMatch(null);
    setSupplierChoice("none");
    setNewProductOpen(false);
    setNewProductLineIdx(null);
    setNewProductPrefill({});
    lastAutoFocusedIdx.current = null;
  };

  const addPages = (files: FileList | File[]) => {
    setPages((ps) => [...ps, ...Array.from(files)]);
  };

  const removePage = (idx: number) => setPages((ps) => ps.filter((_, i) => i !== idx));

  const fileToDataUrl = async (file: File) => {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) return fileToCompressedDataUrl(file);
    const { pdfToCompressedDataUrl } = await import("./pdf");
    return pdfToCompressedDataUrl(file);
  };

  const runScan = async () => {
    if (pages.length === 0) return;
    setStage("extracting");
    setError("");
    try {
      const images = await Promise.all(pages.map(fileToDataUrl));
      const bill = await extract({ data: { images } });
      setExtracted(bill);

      const [prodRes, bcRes] = await Promise.all([
        supabase.from("products").select("id,name,sku,barcode,cost_price,sell_price,stock").eq("is_active", true).limit(5000),
        supabase.from("product_barcodes").select("product_id,barcode").limit(5000),
      ]);
      const prods = (prodRes.data ?? []) as MatchedProductOption[];
      const extraBc = (bcRes.data ?? []) as { product_id: string; barcode: string }[];
      setProducts(prods);
      setExtraBarcodes(extraBc);

      const lines = bill.items
        .filter((i) => i.name || i.barcode || i.sku)
        .map((i) => buildPreviewLine(i, prods, extraBc));
      setPreview(lines);

      const sMatch = matchSupplier(bill.supplier_name, suppliers);
      setSupplierMatch(sMatch);
      setSupplierChoice(sMatch.supplier_id ?? "none");

      setStage("review");
    } catch (e: any) {
      setError(e?.message ?? "Could not read this bill. Try a clearer photo or a different file.");
      setStage("error");
    }
  };

  const patchLine = (idx: number, patch: Partial<PreviewLine>) =>
    setPreview((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const applyProductToLine = (idx: number, product: MatchedProductOption, via: NonNullable<PreviewLine["resolvedVia"]>) => {
    setPreview((ls) => ls.map((l, i) => (i === idx ? {
      ...l,
      product_id: product.id,
      product_name: product.name,
      barcode: product.barcode,
      sku: product.sku,
      cost: product.cost_price || l.cost,
      matchStatus: "matched",
      matchConfidence: 100,
      resolvedVia: via,
    } : l)));
  };

  const commitTypedName = (idx: number, typedName: string) => {
    const hit = products.find((p) => p.name.toLowerCase() === typedName.trim().toLowerCase());
    if (hit) {
      applyProductToLine(idx, hit, "search");
    } else {
      patchLine(idx, { product_id: null, product_name: typedName, matchStatus: "unmatched", matchConfidence: 0, resolvedVia: undefined });
    }
  };

  /** Scoped to this tenant's already-loaded catalogue only (the initial
   * products/product_barcodes query is RLS-filtered server-side) — never a
   * cross-shop lookup. */
  const findByBarcode = (code: string): MatchedProductOption | null => {
    const norm = code.trim().toLowerCase();
    if (!norm) return null;
    const direct = products.find((p) => (p.barcode ?? "").toLowerCase() === norm);
    if (direct) return direct;
    const extra = extraBarcodes.find((b) => b.barcode.toLowerCase() === norm);
    return extra ? (products.find((p) => p.id === extra.product_id) ?? null) : null;
  };

  const resolveScan = (idx: number, rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    const hit = findByBarcode(code);
    if (hit) {
      applyProductToLine(idx, hit, "scan");
    } else {
      setNewProductLineIdx(idx);
      setNewProductPrefill({ name: preview[idx]?.extracted_name || preview[idx]?.product_name, barcode: code });
      setNewProductOpen(true);
    }
  };

  const handleNewProductSaved = (p: QuickAddedProduct) => {
    const option: MatchedProductOption = { id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, cost_price: p.cost_price, sell_price: p.sell_price, stock: p.stock };
    // Fold the freshly created product straight into this session's own
    // catalogue snapshot — if the same new barcode shows up again later in
    // this same bill, it now resolves locally instead of creating a
    // duplicate product row.
    setProducts((prev) => [...prev, option]);
    if (p.barcode) setExtraBarcodes((prev) => [...prev, { product_id: p.id, barcode: p.barcode as string }]);
    if (newProductLineIdx !== null) applyProductToLine(newProductLineIdx, option, "new");
    setNewProductLineIdx(null);
  };

  // Auto-advance: focus the next still-unresolved line's scan field, but
  // only when which line is "next" actually changes — never on every
  // keystroke elsewhere in the table (qty/cost edits on other rows also
  // touch `preview`), or it would yank focus away mid-edit.
  useEffect(() => {
    if (stage !== "review") return;
    const idx = preview.findIndex((l) => l.matchStatus !== "matched");
    if (idx >= 0 && idx !== lastAutoFocusedIdx.current) {
      lastAutoFocusedIdx.current = idx;
      scanRefs.current[idx]?.focus();
    }
  }, [preview, stage]);

  const totals = useMemo(() => {
    const billDiscount = Number(extracted?.total_discount ?? 0) || 0;
    const lineTaxSum = preview.reduce((s, _l, i) => s + Number(extracted?.items[i]?.tax ?? 0), 0);
    const tax = Number(extracted?.total_tax ?? lineTaxSum) || 0;
    const calc = calculatePurchaseTotals({
      lines: preview.map((l) => ({ qty: l.qty, cost: l.cost, discount: l.discount })),
      tax,
      taxMode: "amt",
      billDiscount,
      discountMode: "amt",
    });
    return { ...calc, tax, billDiscount };
  }, [preview, extracted]);

  const grandTotalMismatch =
    extracted?.grand_total != null && Math.abs(Number(extracted.grand_total) - totals.total) > Math.max(1, totals.total * 0.02);

  // Anything short of a confirmed 100% match (barcode/sku from the bill, or
  // resolved here via scan/search/new-product) still needs the purchaser to
  // scan or search it before the purchase can proceed.
  const unresolvedCount = preview.filter((l) => l.matchStatus !== "matched").length;
  const needsReview = unresolvedCount > 0;

  const confirm = () => {
    if (preview.length === 0) {
      toast.error("No items to import");
      return;
    }
    if (unresolvedCount > 0) {
      toast.error(`${unresolvedCount} item${unresolvedCount > 1 ? "s" : ""} still need${unresolvedCount > 1 ? "" : "s"} to be scanned or matched`);
      return;
    }
    onImport({
      supplierId: supplierChoice !== "none" ? supplierChoice : null,
      lines: preview.map((l) => ({
        product_id: l.product_id,
        name: l.product_name || l.extracted_name,
        qty: l.qty,
        cost: l.cost,
        discount: l.discount,
        barcode: l.barcode,
        item_code: l.sku,
      })),
      date: extracted?.invoice_date ?? null,
      note: extracted?.invoice_number ? `Invoice #${extracted.invoice_number}` : "",
      tax: totals.tax,
    });
    setOpen(false);
    reset();
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Camera className="h-4 w-4 mr-2" /> Scan Purchase Bill
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="w-[98vw] max-w-[1200px] max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Scan Purchase Bill</DialogTitle></DialogHeader>

          {stage === "idle" && (
            <div className="py-10 text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload photo(s) or PDF page(s) of the supplier's bill — add more than one if the bill has multiple pages, or you have separate photos of it. AI reads them together as one bill — you review and confirm before anything is saved.
              </p>

              {pages.length > 0 && (
                <div className="mx-auto max-w-md text-left space-y-1.5">
                  {pages.map((f, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
                      <span className="truncate flex items-center gap-2 min-w-0">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{f.name}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removePage(idx)}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        title="Remove this page"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-center gap-2 flex-wrap">
                <label className="inline-block">
                  <input
                    type="file"
                    accept="image/*,application/pdf,.pdf"
                    capture="environment"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) addPages(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <span className="inline-flex items-center gap-2 px-4 py-2 rounded-md border bg-primary text-primary-foreground cursor-pointer hover:opacity-90">
                    {pages.length > 0 ? <Plus className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                    {pages.length > 0 ? "Add Another Page" : "Choose Photo / PDF or Take Photo"}
                  </span>
                </label>
                {pages.length > 0 && (
                  <Button onClick={runScan}>
                    Scan {pages.length} Page{pages.length > 1 ? "s" : ""}
                  </Button>
                )}
              </div>
            </div>
          )}

          {stage === "extracting" && (
            <div className="py-16 text-center space-y-3">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
              <p className="text-sm text-muted-foreground">Reading the bill…</p>
            </div>
          )}

          {stage === "error" && (
            <div className="py-10 text-center space-y-4">
              <AlertTriangle className="h-8 w-8 mx-auto text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
              {/* Back to idle, not a full reset — keeps the already-picked pages so a
                  transient failure (AI busy, network blip) doesn't force re-selecting everything. */}
              <Button variant="outline" onClick={() => setStage("idle")}>Try again</Button>
            </div>
          )}

          {stage === "review" && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Supplier {supplierMatch && <StatusBadge tone={supplierMatch.status === "matched" ? "success" : supplierMatch.status === "review" ? "warning" : "neutral"}>{supplierMatch.status === "matched" ? "Matched" : supplierMatch.status === "review" ? "Supplier Review Required" : "Unmatched"}</StatusBadge>}</Label>
                  <select
                    className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                    value={supplierChoice}
                    onChange={(e) => setSupplierChoice(e.target.value)}
                  >
                    <option value="none">— Select supplier{extracted?.supplier_name ? ` (bill says "${extracted.supplier_name}")` : ""} —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Invoice #</Label>
                    <Input value={extracted?.invoice_number ?? ""} onChange={(e) => setExtracted((b) => b && { ...b, invoice_number: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Invoice date</Label>
                    <Input type="date" value={extracted?.invoice_date ?? ""} onChange={(e) => setExtracted((b) => b && { ...b, invoice_date: e.target.value })} />
                  </div>
                </div>
              </div>

              {grandTotalMismatch && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    Bill total (as read: {extracted?.grand_total}) doesn't match the calculated total ({totals.total.toFixed(2)}) from the items below.
                    Review quantities, rates, and discounts before confirming.
                  </div>
                </div>
              )}

              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Extracted / Product</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Discount</TableHead>
                      <TableHead className="text-right">Line Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((l, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="min-w-[240px]">
                          <div className="text-[10px] text-muted-foreground truncate">As on bill: {l.extracted_name}</div>
                          <ProductPicker
                            products={products}
                            value={l.product_name}
                            onTextChange={(text) => patchLine(idx, { product_name: text })}
                            onCommit={(text) => commitTypedName(idx, text)}
                            onSelect={(p) => applyProductToLine(idx, p, "search")}
                            placeholder="Type to search this shop's products…"
                          />
                          {l.resolvedVia && (
                            <div className={`mt-1 text-[10px] font-medium ${l.resolvedVia === "new" ? "text-blue-600 dark:text-blue-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                              {RESOLVED_VIA_LABEL[l.resolvedVia]}
                            </div>
                          )}
                          {l.matchStatus !== "matched" && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <Barcode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <input
                                ref={(el) => { scanRefs.current[idx] = el; }}
                                className="w-full h-7 rounded border bg-background px-2 text-xs"
                                placeholder="Scan barcode to confirm…"
                                onKeyDown={(e) => {
                                  if (e.key !== "Enter") return;
                                  e.preventDefault();
                                  resolveScan(idx, e.currentTarget.value);
                                  e.currentTarget.value = "";
                                }}
                              />
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={STATUS_TONE[l.matchStatus]}>
                            {STATUS_LABEL[l.matchStatus]}{l.matchStatus !== "unmatched" ? ` ${l.matchConfidence}%` : ""}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input type="number" className="w-20 h-8 text-right ml-auto" value={l.qty} onChange={(e) => patchLine(idx, { qty: Number(e.target.value) || 0 })} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input type="number" className="w-24 h-8 text-right ml-auto" value={l.cost} onChange={(e) => patchLine(idx, { cost: Number(e.target.value) || 0 })} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input type="number" className="w-20 h-8 text-right ml-auto" value={l.discount} onChange={(e) => patchLine(idx, { discount: Number(e.target.value) || 0 })} />
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {(l.qty * l.cost - l.discount).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {needsReview && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {unresolvedCount} item{unresolvedCount > 1 ? "s" : ""} not 100% matched — scan its barcode to confirm, search for it if you know it's already in your system, or scanning an unrecognized barcode opens "Add new product" for you.
                </p>
              )}

              <div className="text-sm text-right text-muted-foreground">
                Calculated total: <span className="font-semibold text-foreground">{totals.total.toFixed(2)}</span>
              </div>
            </div>
          )}

          <DialogFooter>
            {stage === "review" && (
              <>
                <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
                <Button onClick={confirm} disabled={unresolvedCount > 0}>
                  {unresolvedCount > 0
                    ? `Resolve ${unresolvedCount} item${unresolvedCount > 1 ? "s" : ""} to continue`
                    : "Continue to Purchase Entry"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <QuickAddProductDialog
        open={newProductOpen}
        onOpenChange={(v) => { setNewProductOpen(v); if (!v) setNewProductLineIdx(null); }}
        prefill={newProductPrefill}
        suppliers={suppliers}
        onSaved={handleNewProductSaved}
      />
    </>
  );
}
