import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2, AlertTriangle, Plus, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { calculatePurchaseTotals } from "@/lib/purchase-totals";
import { extractPurchaseBill } from "./scan.functions";
import { fileToCompressedDataUrl } from "./image";
import { pdfToCompressedDataUrl } from "./pdf";
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
  const [supplierMatch, setSupplierMatch] = useState<SupplierMatch | null>(null);
  const [supplierChoice, setSupplierChoice] = useState<string>("none");
  const extract = useServerFn(extractPurchaseBill);

  const reset = () => {
    setStage("idle");
    setError("");
    setPages([]);
    setPreview([]);
    setExtracted(null);
    setProducts([]);
    setSupplierMatch(null);
    setSupplierChoice("none");
  };

  const addPages = (files: FileList | File[]) => {
    setPages((ps) => [...ps, ...Array.from(files)]);
  };

  const removePage = (idx: number) => setPages((ps) => ps.filter((_, i) => i !== idx));

  const fileToDataUrl = (file: File) => {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    return isPdf ? pdfToCompressedDataUrl(file) : fileToCompressedDataUrl(file);
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
      const extraBarcodes = (bcRes.data ?? []) as { product_id: string; barcode: string }[];
      setProducts(prods);

      const lines = bill.items
        .filter((i) => i.name || i.barcode || i.sku)
        .map((i) => buildPreviewLine(i, prods, extraBarcodes));
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

  const assignProductByName = (idx: number, typedName: string) => {
    const hit = products.find((p) => p.name.toLowerCase() === typedName.trim().toLowerCase());
    if (hit) {
      patchLine(idx, {
        product_id: hit.id,
        product_name: hit.name,
        barcode: hit.barcode,
        sku: hit.sku,
        cost: hit.cost_price || preview[idx].cost,
        matchStatus: "matched",
        matchConfidence: 100,
      });
    } else {
      patchLine(idx, { product_id: null, product_name: typedName, matchStatus: "unmatched", matchConfidence: 0 });
    }
  };

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

  const needsReview = preview.some((l) => l.matchStatus === "review" || l.matchStatus === "ambiguous" || l.matchStatus === "unmatched");

  const confirm = () => {
    if (preview.length === 0) {
      toast.error("No items to import");
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
                        <TableCell className="min-w-[220px]">
                          <div className="text-[10px] text-muted-foreground truncate">{l.extracted_name}</div>
                          <input
                            list={`pab-products-${idx}`}
                            className="w-full h-8 rounded border bg-background px-2 text-sm mt-0.5"
                            value={l.product_name}
                            onChange={(e) => patchLine(idx, { product_name: e.target.value })}
                            onBlur={(e) => assignProductByName(idx, e.target.value)}
                          />
                          <datalist id={`pab-products-${idx}`}>
                            {(l.candidates.length ? l.candidates : products.slice(0, 50)).map((p) => (
                              <option key={p.id} value={p.name} />
                            ))}
                          </datalist>
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
                <p className="text-xs text-amber-700 dark:text-amber-400">Some items need review — pick the correct product above. You can also fix this on the next screen before saving.</p>
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
                <Button onClick={confirm}>Continue to Purchase Entry</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
