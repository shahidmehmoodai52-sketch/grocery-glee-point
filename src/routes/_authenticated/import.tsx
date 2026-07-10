import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  Upload, FileDown, CheckCircle2, AlertCircle, Loader2, Database,
  FileSpreadsheet, Wand2, History, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/import")({ component: Page });

// ---------- Import batches: create + finalize ----------

type BatchSource = "single_merged" | "smart_merge" | "products" | "customers" | "suppliers";

async function createImportBatch(filename: string, source: BatchSource): Promise<string | null> {
  const { data, error } = await supabase
    .from("import_batches")
    .insert({ filename, source })
    .select("id")
    .single();
  if (error) { console.error(error); return null; }
  return data?.id ?? null;
}

async function finalizeImportBatch(
  id: string | null,
  counts: { products?: number; barcodes?: number; customers?: number; suppliers?: number; failed?: number; notes?: string },
) {
  if (!id) return;
  await supabase.from("import_batches").update({
    products_count: counts.products ?? 0,
    barcodes_count: counts.barcodes ?? 0,
    customers_count: counts.customers ?? 0,
    suppliers_count: counts.suppliers ?? 0,
    failed_count: counts.failed ?? 0,
    notes: counts.notes ?? null,
  }).eq("id", id);
}


type EntityKey = "products" | "customers" | "suppliers";

const SCHEMAS: Record<EntityKey, { fields: { key: string; label: string; required?: boolean; type?: "number" | "bool" }[]; sample: any[][]; onConflict?: string }> = {
  products: {
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "sku", label: "SKU / Item Code" },
      { key: "barcode", label: "Barcode" },
      { key: "category", label: "Category" },
      { key: "unit", label: "Unit" },
      { key: "cost_price", label: "Cost / Purchase Price", type: "number" },
      { key: "sell_price", label: "Sale Price", type: "number" },
      { key: "stock", label: "Stock Qty", type: "number" },
      { key: "tax_rate", label: "Tax %", type: "number" },
      { key: "is_active", label: "Active", type: "bool" },
    ],
    sample: [
      ["name","sku","barcode","category","unit","cost_price","sell_price","stock","tax_rate"],
      ["Sugar 1kg","SUG001","8964000111111","Grocery","pcs",120,140,50,0],
      ["Rice 5kg","RIC005","8964000222222","Grocery","pcs",1100,1250,20,0],
    ],
    onConflict: "sku",
  },
  customers: {
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "address", label: "Address" },
      { key: "balance", label: "Opening Balance (they owe)", type: "number" },
    ],
    sample: [
      ["name","phone","email","address","balance"],
      ["Ahmed Khan","03001234567","ahmed@example.com","Lahore",0],
    ],
  },
  suppliers: {
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "address", label: "Address" },
      { key: "balance", label: "Opening Balance (we owe)", type: "number" },
    ],
    sample: [
      ["name","phone","email","address","balance"],
      ["Metro Wholesale","0429876543","info@metro.pk","Lahore",0],
    ],
  },
};

// Parse any spreadsheet file (xlsx, xls, csv) into rows of objects keyed by header
async function parseSpreadsheet(file: File): Promise<{ headers: string[]; rows: Record<string, any>[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve({ headers: res.meta.fields ?? [], rows: res.data as any[] }),
        error: reject,
      });
    });
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "", raw: true });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

// Broadcast when an import batch is created / updated / deleted so the
// history panel can refresh itself without prop-drilling.
const BATCH_EVENT = "import-batch-changed";
function notifyBatchChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(BATCH_EVENT));
}

// Invalidate every query that surfaces product / customer / supplier data so
// pages like POS pick up freshly imported stock and prices without waiting for
// realtime replication or the 5-minute staleTime.
function invalidateAfterImport(qc: ReturnType<typeof useQueryClient>) {
  ["products", "product_barcodes", "customers", "suppliers", "dash-products"].forEach((key) => {
    qc.invalidateQueries({ queryKey: [key] });
  });
}

function Page() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Bulk import &amp; export</h1>
          <p className="text-sm text-muted-foreground">Excel (.xlsx / .xls) ya CSV files upload karen — ya pora system data Excel me export karen.</p>
        </div>
        <ExportAllButton />
      </div>

      <Tabs defaultValue="single">
        <TabsList>
          <TabsTrigger value="single"><FileSpreadsheet className="h-4 w-4 mr-1" />Merged file (multi-barcode)</TabsTrigger>
          <TabsTrigger value="smart"><Wand2 className="h-4 w-4 mr-1" />Smart merge (2 files)</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="history"><History className="h-4 w-4 mr-1" />Uploaded files</TabsTrigger>
        </TabsList>
        <TabsContent value="single" className="mt-4"><SingleMergedFile /></TabsContent>
        <TabsContent value="smart" className="mt-4"><SmartMerge /></TabsContent>
        {(["products", "customers", "suppliers"] as EntityKey[]).map((k) => (
          <TabsContent key={k} value={k} className="mt-4">
            <Importer entity={k} />
          </TabsContent>
        ))}
        <TabsContent value="history" className="mt-4"><ImportHistory /></TabsContent>
      </Tabs>

      {/* Compact history at the bottom of every tab so uploaded files are
          always visible without hunting through tabs. */}
      <ImportHistory compact />
    </div>
  );
}

// ---------------- Import history: list uploaded files & delete their data ----------------

type BatchRow = {
  id: string;
  filename: string;
  source: string;
  products_count: number;
  barcodes_count: number;
  customers_count: number;
  suppliers_count: number;
  failed_count: number;
  notes: string | null;
  created_at: string;
};

function ImportHistory({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("import_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setRows((data as BatchRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener(BATCH_EVENT, onChange);
    return () => window.removeEventListener(BATCH_EVENT, onChange);
  }, [load]);

  const deleteBatch = async (b: BatchRow) => {
    const totalItems = b.products_count + b.barcodes_count + b.customers_count + b.suppliers_count;
    const msg = `"${b.filename}" delete karen?\n\nIs file se imported ${totalItems} records (products/barcodes/customers/suppliers) bhi permanently delete ho jain ge. Sales/purchases history rahegi. Continue?`;
    if (!confirm(msg)) return;
    setDeletingId(b.id);
    // ON DELETE CASCADE on the FK removes the tagged rows automatically.
    const { error } = await supabase.from("import_batches").delete().eq("id", b.id);
    setDeletingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`"${b.filename}" aur uska imported data delete ho gaya`);
    notifyBatchChanged();
  };

  const shown = compact ? rows.slice(0, 5) : rows;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            Uploaded files
            {compact && rows.length > 5 && (
              <span className="text-xs text-muted-foreground font-normal">
                · latest 5 (see the “Uploaded files” tab for all)
              </span>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            Har upload ka record — kisi file ko delete karen to us file se imported data bhi hat jayega.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
          Refresh
        </Button>
      </div>

      {loading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          Abhi tak koi file upload nahi ki gayi.
        </p>
      ) : (
        <div className="max-h-96 overflow-auto border rounded">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Imported</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((b) => {
                const parts: string[] = [];
                if (b.products_count) parts.push(`${b.products_count} products`);
                if (b.barcodes_count) parts.push(`${b.barcodes_count} barcodes`);
                if (b.customers_count) parts.push(`${b.customers_count} customers`);
                if (b.suppliers_count) parts.push(`${b.suppliers_count} suppliers`);
                if (b.failed_count) parts.push(`${b.failed_count} failed`);
                return (
                  <TableRow key={b.id}>
                    <TableCell className="text-xs">
                      <div className="font-medium truncate max-w-[280px]" title={b.filename}>{b.filename}</div>
                      {b.notes && <div className="text-[10px] text-muted-foreground truncate max-w-[280px]">{b.notes}</div>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{b.source}</Badge></TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(b.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs text-right">
                      {parts.length ? parts.join(" · ") : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteBatch(b)}
                        disabled={deletingId === b.id}
                        title="Delete this file and all data it imported"
                      >
                        {deletingId === b.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Trash2 className="h-3 w-3" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

// ---------------- Smart merge: stockmaster + barcode by item code ----------------

const FIELD_HINTS: Record<string, string[]> = {
  name: ["name","item name","itemname","description","product","product name","particulars","title"],
  sku: ["sku","item code","itemcode","code","item no","item#","item number","itemno","prod code","product code","barcode"],
  barcode: ["barcode","bar code","ean","upc","scan","scancode","scan code"],
  category: ["category","cat","group","department"],
  unit: ["unit","uom","measure"],
  cost_price: ["cost","cost price","purchase","purchase rate","p rate","prate","p.rate","purchase price","buy","buying"],
  sell_price: ["sale","sale rate","sell","sell price","sale price","s rate","srate","s.rate","mrp","retail","price"],
  stock: ["stock","qty","quantity","on hand","onhand","balance","stock qty","stockqty","closing","opening"],
  tax_rate: ["tax","tax %","tax rate","gst","vat"],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function autoMap(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, hints] of Object.entries(FIELD_HINTS)) {
    const normHeaders = headers.map((h) => ({ raw: h, n: norm(h) }));
    let hit = normHeaders.find((h) => hints.some((x) => h.n === norm(x)));
    if (!hit) hit = normHeaders.find((h) => hints.some((x) => h.n.includes(norm(x))));
    if (hit) out[key] = hit.raw;
  }
  return out;
}

// --------- Content-based smart auto-mapping ---------
// Looks at the ACTUAL data (first ~200 rows) to decide which column is what,
// because some exports have misleading header names (e.g. label says "itemname"
// but the column actually contains item codes).
type ColStats = {
  header: string;
  nonEmpty: number;
  total: number;
  numericCount: number;
  intCount: number;
  decimalCount: number;
  longDigitCount: number; // 8-14 digit pure numbers = barcodes
  shortTokenCount: number; // 2-5 char short tokens = units
  hasLettersCount: number;
  dateCount: number;
  uniqueCount: number;
  avgLen: number;
  samples: string[];
};

function analyzeColumns(headers: string[], rows: Record<string, any>[]): Record<string, ColStats> {
  const sample = rows.slice(0, 200);
  const stats: Record<string, ColStats> = {};
  for (const h of headers) {
    const uniques = new Set<string>();
    let nonEmpty = 0, numericCount = 0, intCount = 0, decimalCount = 0;
    let longDigit = 0, shortTok = 0, hasLetters = 0, dateCount = 0, lenSum = 0;
    const samples: string[] = [];
    for (const r of sample) {
      const raw = r[h];
      if (raw === null || raw === undefined || raw === "") continue;
      const s = String(raw).trim();
      if (!s) continue;
      nonEmpty++;
      uniques.add(s);
      lenSum += s.length;
      if (samples.length < 5) samples.push(s);
      // date-ish?
      if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(s)) { dateCount++; continue; }
      // pure digits (barcode-ish)
      if (/^\d{8,14}$/.test(s)) longDigit++;
      // numeric
      const n = Number(s.replace(/,/g, ""));
      if (!isNaN(n) && /^-?\d+(\.\d+)?$/.test(s.replace(/,/g, ""))) {
        numericCount++;
        if (Number.isInteger(n)) intCount++;
        if (s.includes(".")) decimalCount++;
      }
      if (/[a-zA-Z]/.test(s)) hasLetters++;
      if (s.length <= 5 && /^[A-Za-z]+$/.test(s)) shortTok++;
    }
    stats[h] = {
      header: h, nonEmpty, total: sample.length, numericCount, intCount, decimalCount,
      longDigitCount: longDigit, shortTokenCount: shortTok, hasLettersCount: hasLetters,
      dateCount, uniqueCount: uniques.size, avgLen: nonEmpty ? lenSum / nonEmpty : 0,
      samples,
    };
  }
  return stats;
}

function smartAutoMap(headers: string[], rows: Record<string, any>[]): Record<string, string> {
  const stats = analyzeColumns(headers, rows);
  const cols = headers.filter((h) => stats[h].nonEmpty > 0);
  const used = new Set<string>();
  const out: Record<string, string> = {};

  // Header-hint match with content sanity
  const hintMatch = (key: string): string | null => {
    const hints = FIELD_HINTS[key] ?? [];
    const normH = cols.map((h) => ({ raw: h, n: norm(h) }));
    let hit = normH.find((h) => !used.has(h.raw) && hints.some((x) => h.n === norm(x)));
    if (!hit) hit = normH.find((h) => !used.has(h.raw) && hints.some((x) => h.n.includes(norm(x))));
    return hit?.raw ?? null;
  };

  const pickBy = (key: string, scorer: (s: ColStats) => number, minScore = 0.1) => {
    let best: { h: string; s: number } | null = null;
    for (const h of cols) {
      if (used.has(h)) continue;
      const sc = scorer(stats[h]);
      if (sc > minScore && (!best || sc > best.s)) best = { h, s: sc };
    }
    return best?.h ?? null;
  };

  const assign = (key: string, h: string | null) => {
    if (!h) return;
    out[key] = h;
    used.add(h);
  };

  // 1) Barcode = mostly long-digit column
  const barcodeHint = hintMatch("barcode");
  if (barcodeHint && stats[barcodeHint].longDigitCount / Math.max(stats[barcodeHint].nonEmpty, 1) > 0.5) {
    assign("barcode", barcodeHint);
  } else {
    assign("barcode", pickBy("barcode", (s) => (s.longDigitCount / Math.max(s.nonEmpty, 1))));
  }

  // 2) Name = strings with letters, high avg length, not units
  const namePick =
    pickBy("name", (s) => {
      const letterRatio = s.hasLettersCount / Math.max(s.nonEmpty, 1);
      const notNumeric = 1 - s.numericCount / Math.max(s.nonEmpty, 1);
      const notShort = Math.min(s.avgLen / 12, 1);
      const notDate = s.dateCount === 0 ? 1 : 0;
      return letterRatio * notNumeric * notShort * notDate;
    });
  assign("name", namePick);

  // 3) SKU / item code = column with MANY distinct short values that repeat
  //    across rows (each product has one code, appearing on all its barcode rows).
  //    Reject constant columns (uniques <= 1) and near-unique columns (looks like id).
  const skuPick =
    pickBy("sku", (s) => {
      if (s.longDigitCount / Math.max(s.nonEmpty, 1) > 0.5) return 0; // barcode
      if (s.uniqueCount <= 1) return 0; // all-same → useless
      const uniqRatio = s.uniqueCount / Math.max(s.nonEmpty, 1);
      // sweet spot: 5%–90% uniques (repeats but many distinct codes)
      if (uniqRatio < 0.02 || uniqRatio > 0.95) return 0;
      const shortIsh = s.avgLen <= 10 ? 1 : 0.3;
      // reward more distinct codes
      return uniqRatio * shortIsh;
    }, 0.02);

  assign("sku", skuPick);

  // 4) Unit = short letter tokens (Pcs, Kg, Grm, Pck, Dzn, Nos, Ltr)
  assign("unit", pickBy("unit", (s) => s.shortTokenCount / Math.max(s.nonEmpty, 1)));

  // 5) Category = letters, medium unique (not too many, not one), not name
  assign("category", pickBy("category", (s) => {
    const letterRatio = s.hasLettersCount / Math.max(s.nonEmpty, 1);
    const uniqRatio = s.uniqueCount / Math.max(s.nonEmpty, 1);
    // categories repeat: uniqRatio small; not extremely small like a boolean
    const catShape = uniqRatio > 0.02 && uniqRatio < 0.5 ? 1 : 0.2;
    return letterRatio * catShape;
  }, 0.15));

  // 6) Cost & sale prices = decimals, non-zero. Prefer header hint, else pick top-2 numeric-decimal columns.
  const priceCandidates = cols
    .filter((h) => !used.has(h) && stats[h].numericCount / Math.max(stats[h].nonEmpty, 1) > 0.8)
    .map((h) => ({ h, s: stats[h], nz: stats[h].nonEmpty > 0 ? 1 : 0 }))
    .filter((c) => c.s.avgLen >= 1)
    .sort((a, b) => (b.s.decimalCount + b.s.avgLen) - (a.s.decimalCount + a.s.avgLen));

  const costHint = hintMatch("cost_price");
  const saleHint = hintMatch("sell_price");
  if (costHint && stats[costHint].numericCount / Math.max(stats[costHint].nonEmpty, 1) > 0.8) assign("cost_price", costHint);
  if (saleHint && stats[saleHint].numericCount / Math.max(stats[saleHint].nonEmpty, 1) > 0.8) assign("sell_price", saleHint);

  if (!out.cost_price) {
    const p = priceCandidates.find((c) => !used.has(c.h));
    if (p) assign("cost_price", p.h);
  }
  if (!out.sell_price) {
    const p = priceCandidates.find((c) => !used.has(c.h));
    if (p) assign("sell_price", p.h);
  }

  // 7) Stock = numeric (int), can be negative, not barcode length, has variance
  //    (skip columns where every row is the same value — those are usually zero placeholders).
  const stockHint = hintMatch("stock");
  const isValidStock = (s: ColStats) =>
    s.longDigitCount / Math.max(s.nonEmpty, 1) <= 0.5 &&
    s.uniqueCount > 1 &&
    s.numericCount / Math.max(s.nonEmpty, 1) > 0.7;
  if (stockHint && isValidStock(stats[stockHint])) {
    assign("stock", stockHint);
  } else {
    assign("stock", pickBy("stock", (s) => {
      if (!isValidStock(s)) return 0;
      const intRatio = s.intCount / Math.max(s.nonEmpty, 1);
      const shortIsh = s.avgLen <= 8 ? 1 : 0.3;
      const varietyBonus = Math.min(s.uniqueCount / 10, 1); // reward some variety
      return intRatio * shortIsh * (0.5 + 0.5 * varietyBonus);
    }, 0.3));
  }


  // 8) Tax = header hint only (usually 0/5/17)
  assign("tax_rate", hintMatch("tax_rate"));

  return out;
}


function SmartMerge() {
  const qc = useQueryClient();
  const fileA = useRef<HTMLInputElement>(null);
  const fileB = useRef<HTMLInputElement>(null);
  const [stockFile, setStockFile] = useState<{ headers: string[]; rows: Record<string, any>[]; name: string } | null>(null);
  const [barcodeFile, setBarcodeFile] = useState<{ headers: string[]; rows: Record<string, any>[]; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ products: number; barcodes: number; failed: number; errors: string[] } | null>(null);

  // Detect which file is "stock" (has name + price/stock) vs "barcode" (mostly barcode + code)
  const handleFile = async (file: File, slot: "auto" | "stock" | "barcode") => {
    const parsed = await parseSpreadsheet(file);
    const map = autoMap(parsed.headers);
    let isBarcode = false;
    if (slot === "auto") {
      const hasBarcode = !!map.barcode;
      const hasName = !!map.name;
      const hasPriceOrStock = !!(map.sell_price || map.cost_price || map.stock);
      // If it has barcode column and (no name OR no price/stock), it's the barcode file
      isBarcode = hasBarcode && (!hasName || !hasPriceOrStock);
    } else {
      isBarcode = slot === "barcode";
    }
    const payload = { headers: parsed.headers, rows: parsed.rows, name: file.name };
    if (isBarcode) setBarcodeFile(payload); else setStockFile(payload);
    toast.success(`${file.name} → ${isBarcode ? "Barcode file" : "Stock master"} (${parsed.rows.length} rows)`);
  };

  const stockMap = useMemo(() => stockFile ? autoMap(stockFile.headers) : {}, [stockFile]);
  const barcodeMap = useMemo(() => barcodeFile ? autoMap(barcodeFile.headers) : {}, [barcodeFile]);

  const merged = useMemo(() => {
    if (!stockFile) return [];
    const m = stockMap;
    const num = (v: any) => Number(String(v ?? "").replace(/[^0-9.\-]/g, "")) || 0;
    const products = stockFile.rows.map((r) => ({
      name: String(r[m.name ?? ""] ?? "").trim(),
      sku: m.sku ? String(r[m.sku] ?? "").trim() : "",
      barcode: m.barcode ? String(r[m.barcode] ?? "").trim() : "",
      category: m.category ? String(r[m.category] ?? "").trim() : null,
      unit: m.unit ? String(r[m.unit] ?? "").trim() : null,
      cost_price: m.cost_price ? num(r[m.cost_price]) : 0,
      sell_price: m.sell_price ? num(r[m.sell_price]) : 0,
      stock: m.stock ? num(r[m.stock]) : 0,
      tax_rate: m.tax_rate ? num(r[m.tax_rate]) : 0,
    })).filter((p) => p.name);
    return products;
  }, [stockFile, stockMap]);

  const extraBarcodes = useMemo(() => {
    if (!barcodeFile || !barcodeMap.sku || !barcodeMap.barcode) return [] as { sku: string; barcode: string }[];
    return barcodeFile.rows
      .map((r) => ({ sku: String(r[barcodeMap.sku] ?? "").trim(), barcode: String(r[barcodeMap.barcode] ?? "").trim() }))
      .filter((x) => x.sku && x.barcode);
  }, [barcodeFile, barcodeMap]);

  const runImport = async () => {
    if (merged.length === 0) return toast.error("Stock master file me koi valid rows nahi");
    setBusy(true); setResult({ products: 0, barcodes: 0, failed: 0, errors: [] });
    const errors: string[] = [];
    let ok = 0, failed = 0;

    // Track this import as a batch so it can be reviewed / deleted later.
    const batchName = [stockFile?.name, barcodeFile?.name].filter(Boolean).join(" + ") || "smart-merge";
    const batchId = await createImportBatch(batchName, "smart_merge");
    const tag = (p: any) => (batchId ? { ...p, import_batch_id: batchId } : p);

    // 1) Upsert products by SKU (when present)
    const chunkSize = 200;
    const withSku = merged.filter((p) => p.sku).map(tag);
    const noSku = merged.filter((p) => !p.sku).map(tag);
    for (let i = 0; i < withSku.length; i += chunkSize) {
      const chunk = withSku.slice(i, i + chunkSize);
      const { error } = await supabase.from("products").upsert(chunk as any, { onConflict: "sku" });
      if (error) { failed += chunk.length; errors.push(error.message); } else ok += chunk.length;
    }
    for (let i = 0; i < noSku.length; i += chunkSize) {
      const chunk = noSku.slice(i, i + chunkSize);
      const { error } = await supabase.from("products").insert(chunk as any);
      if (error) { failed += chunk.length; errors.push(error.message); } else ok += chunk.length;
    }

    // 2) Handle extra barcodes — need product IDs via SKU lookup
    let bcOk = 0;
    if (extraBarcodes.length > 0) {
      const uniqueSkus = [...new Set(extraBarcodes.map((x) => x.sku))];
      const skuToId: Record<string, string> = {};
      for (let i = 0; i < uniqueSkus.length; i += 500) {
        const slice = uniqueSkus.slice(i, i + 500);
        const { data } = await supabase.from("products").select("id, sku").in("sku", slice);
        (data ?? []).forEach((p: any) => { if (p.sku) skuToId[p.sku] = p.id; });
      }
      const rows = extraBarcodes
        .map((x) => tag({ product_id: skuToId[x.sku], barcode: x.barcode }))
        .filter((x) => x.product_id);
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase.from("product_barcodes").upsert(chunk as any, { onConflict: "barcode" });
        if (error) errors.push(error.message); else bcOk += chunk.length;
      }
    }

    await finalizeImportBatch(batchId, { products: ok, barcodes: bcOk, failed });
    notifyBatchChanged();
    invalidateAfterImport(qc);

    setBusy(false);
    setResult({ products: ok, barcodes: bcOk, failed, errors: [...new Set(errors)].slice(0, 5) });
    if (failed === 0) toast.success(`Imported ${ok} products, ${bcOk} extra barcodes`);
    else toast.error(`${ok} imported, ${failed} failed`);
  };

  return (
    <div className="space-y-4">
      <Alert>
        <Wand2 className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Apni <b>do Excel files</b> upload karen: ek stock/item master (name, rate, stock) aur dosri barcode list (item code + barcode).
          System dono ko khud detect karega, item code par jodega, aur products + multiple barcodes set kar dega.
          <b> Existing SKU update ho jata hai</b>, naya add ho jata hai.
        </AlertDescription>
      </Alert>

      <div className="grid md:grid-cols-2 gap-4">
        <FileSlot
          label="File 1 (Stock master)"
          file={stockFile}
          map={stockMap}
          required={["name"]}
          inputRef={fileA}
          onPick={(f) => handleFile(f, "auto")}
          onClear={() => setStockFile(null)}
        />
        <FileSlot
          label="File 2 (Barcodes)"
          file={barcodeFile}
          map={barcodeMap}
          required={["sku","barcode"]}
          inputRef={fileB}
          onPick={(f) => handleFile(f, "auto")}
          onClear={() => setBarcodeFile(null)}
        />
      </div>

      {merged.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-medium">Preview</h3>
              <p className="text-xs text-muted-foreground">
                {merged.length} products · {extraBarcodes.length} extra barcodes (linked by item code)
              </p>
            </div>
            <Button onClick={runImport} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Import everything
            </Button>
          </div>
          <div className="max-h-72 overflow-auto border rounded">
            <Table>
              <TableHeader><TableRow>
                <TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead>Barcode</TableHead>
                <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Sale</TableHead><TableHead className="text-right">Stock</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {merged.slice(0, 50).map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{p.sku}</TableCell>
                    <TableCell className="text-xs">{p.name}</TableCell>
                    <TableCell className="text-xs">{p.barcode}</TableCell>
                    <TableCell className="text-xs text-right">{p.cost_price}</TableCell>
                    <TableCell className="text-xs text-right">{p.sell_price}</TableCell>
                    <TableCell className="text-xs text-right">{p.stock}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {merged.length > 50 && <p className="text-xs text-muted-foreground">Showing first 50 of {merged.length}.</p>}
        </Card>
      )}

      {result && (
        <Alert variant={result.failed > 0 ? "destructive" : "default"}>
          {result.failed === 0 ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertDescription>
            <div><b>{result.products}</b> products imported · <b>{result.barcodes}</b> extra barcodes · <b>{result.failed}</b> failed.</div>
            {result.errors.length > 0 && <ul className="mt-2 text-xs list-disc pl-4">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function FileSlot({ label, file, map, required, inputRef, onPick, onClear }: {
  label: string;
  file: { headers: string[]; rows: any[]; name: string } | null;
  map: Record<string, string>;
  required: string[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (f: File) => void;
  onClear: () => void;
}) {
  const missing = required.filter((k) => !map[k]);
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">{label}</h3>
        {file ? (
          <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
        ) : (
          <>
            <input ref={inputRef} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
              <FileSpreadsheet className="h-4 w-4 mr-1" />Choose file
            </Button>
          </>
        )}
      </div>
      {file && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground truncate">📄 {file.name} · {file.rows.length} rows</p>
          <div className="flex flex-wrap gap-1">
            {Object.entries(map).map(([k, v]) => (
              <Badge key={k} variant="secondary" className="text-[10px]">{k} ← {v}</Badge>
            ))}
          </div>
          {missing.length > 0 && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="h-3 w-3" />
              <AlertDescription className="text-xs">Required column not detected: {missing.join(", ")}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------- Single-entity importer (now supports xlsx) ----------------

function Importer({ entity }: { entity: EntityKey }) {
  const qc = useQueryClient();
  const schema = SCHEMAS[entity];
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: number; errors: string[] } | null>(null);
  const [filename, setFilename] = useState<string>("");

  const parseFile = async (file: File) => {
    setResult(null);
    setFilename(file.name);
    try {
      const { headers: hdrs, rows: data } = await parseSpreadsheet(file);
      setHeaders(hdrs); setRows(data);
      const auto: Record<string, string> = {};
      schema.fields.forEach((f) => {
        const hints = FIELD_HINTS[f.key] ?? [f.key];
        const hit = hdrs.find((h) => hints.some((x) => norm(h) === norm(x)))
          || hdrs.find((h) => hints.some((x) => norm(h).includes(norm(x))));
        if (hit) auto[f.key] = hit;
      });
      setMapping(auto);
      toast.success(`Parsed ${data.length} rows`);
    } catch (e: any) { toast.error(e.message); }
  };

  const mapped = useMemo(() => {
    return rows.map((r) => {
      const out: Record<string, any> = {};
      schema.fields.forEach((f) => {
        const src = mapping[f.key];
        if (!src) return;
        let v: any = r[src];
        if (v === undefined || v === null || v === "") return;
        if (f.type === "number") v = Number(String(v).replace(/[^0-9.\-]/g, "")) || 0;
        else if (f.type === "bool") v = ["1", "true", "yes", "y"].includes(String(v).toLowerCase());
        else v = String(v).trim();
        out[f.key] = v;
      });
      return out;
    }).filter((r) => r.name);
  }, [rows, mapping, schema]);

  const downloadSample = () => {
    const ws = XLSX.utils.aoa_to_sheet(schema.sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, entity);
    XLSX.writeFile(wb, `${entity}-sample.xlsx`);
  };

  const runImport = async () => {
    if (mapped.length === 0) return toast.error("No rows to import");
    setBusy(true); setResult({ ok: 0, failed: 0, errors: [] });
    const errors: string[] = []; let ok = 0, failed = 0;
    const chunkSize = 200;
    const batchId = await createImportBatch(filename || `${entity}-upload`, entity);
    const tag = (r: any) => (batchId ? { ...r, import_batch_id: batchId } : r);
    for (let i = 0; i < mapped.length; i += chunkSize) {
      const chunk = mapped.slice(i, i + chunkSize).map(tag);
      if (entity === "products" && schema.onConflict) {
        const withKey = chunk.filter((r) => r.sku);
        const withoutKey = chunk.filter((r) => !r.sku);
        if (withKey.length) {
          const { error } = await supabase.from("products").upsert(withKey as any, { onConflict: "sku" });
          if (error) { failed += withKey.length; errors.push(error.message); } else ok += withKey.length;
        }
        if (withoutKey.length) {
          const { error } = await supabase.from("products").insert(withoutKey as any);
          if (error) { failed += withoutKey.length; errors.push(error.message); } else ok += withoutKey.length;
        }
      } else {
        const { error } = await supabase.from(entity).insert(chunk as any);
        if (error) { failed += chunk.length; errors.push(error.message); } else ok += chunk.length;
      }
      setResult({ ok, failed, errors: [...new Set(errors)].slice(0, 5) });
    }
    await finalizeImportBatch(batchId, {
      products: entity === "products" ? ok : 0,
      customers: entity === "customers" ? ok : 0,
      suppliers: entity === "suppliers" ? ok : 0,
      failed,
    });
    notifyBatchChanged();
    invalidateAfterImport(qc);
    setBusy(false);
    if (failed === 0) toast.success(`Imported ${ok} rows`); else toast.error(`${ok} imported, ${failed} failed`);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-medium">Step 1 — Upload file</h3>
            <p className="text-xs text-muted-foreground">Excel (.xlsx, .xls) ya CSV. First row me headers honi chahiye.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadSample}><FileDown className="h-4 w-4 mr-2" />Sample Excel</Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
            <Button onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2" />{filename ? "Change file" : "Choose file"}</Button>
          </div>
        </div>
        {filename && (
          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate" title={filename}>{filename}</div>
                <div className="text-[11px] text-muted-foreground">
                  {rows.length} rows · {headers.length} columns{mapped.length !== rows.length ? ` · ${mapped.length} ready` : ""}
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFilename(""); setHeaders([]); setRows([]); setMapping({}); setResult(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
            </Button>
          </div>
        )}
      </Card>

      {headers.length > 0 && (
        <Card className="p-4 space-y-3">
          <h3 className="font-medium">Step 2 — Map columns</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {schema.fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label} {f.required && <span className="text-destructive">*</span>}</Label>
                <Select value={mapping[f.key] ?? "__none__"} onValueChange={(v) => setMapping({ ...mapping, [f.key]: v === "__none__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="— skip —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— skip —</SelectItem>
                    {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </Card>
      )}

      {mapped.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Step 3 — Preview ({mapped.length} rows)</h3>
            <Button onClick={runImport} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Import {mapped.length} rows
            </Button>
          </div>
          {entity === "products" && (
            <Alert><AlertDescription className="text-xs">
              Matching <b>SKU</b> rows update ho jain gi (stock &amp; prices overwrite). Bina SKU ke rows nayi add hongi.
            </AlertDescription></Alert>
          )}
          <div className="max-h-72 overflow-auto border rounded">
            <Table>
              <TableHeader><TableRow>
                {schema.fields.filter((f) => mapping[f.key]).map((f) => <TableHead key={f.key}>{f.label}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {mapped.slice(0, 50).map((r, i) => (
                  <TableRow key={i}>
                    {schema.fields.filter((f) => mapping[f.key]).map((f) => (
                      <TableCell key={f.key} className="text-xs">{String(r[f.key] ?? "")}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {result && (
        <Alert variant={result.failed > 0 ? "destructive" : "default"}>
          {result.failed === 0 ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertDescription>
            <div><b>{result.ok}</b> imported, <b>{result.failed}</b> failed.</div>
            {result.errors.length > 0 && <ul className="mt-2 text-xs list-disc pl-4">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ---------------- Full system export to Excel ----------------

function ExportAllButton() {
  const [busy, setBusy] = useState(false);

  const exportAll = async () => {
    setBusy(true);
    try {
      const tables = [
        "products","product_barcodes","customers","suppliers",
        "sales","sale_items","sale_returns","sale_return_items",
        "purchases","purchase_items","purchase_returns","purchase_return_items",
        "expenses","expense_persons","party_payments",
      ] as const;

      const wb = XLSX.utils.book_new();
      let total = 0;
      for (const t of tables) {
        const { data, error } = await supabase.from(t).select("*").limit(50000);
        if (error) { toast.error(`${t}: ${error.message}`); continue; }
        const ws = XLSX.utils.json_to_sheet(data ?? []);
        XLSX.utils.book_append_sheet(wb, ws, t.slice(0, 31));
        total += (data ?? []).length;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `pos-backup-${stamp}.xlsx`);
      toast.success(`Exported ${total} rows across ${tables.length} sheets`);
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  };

  return (
    <Button onClick={exportAll} disabled={busy} variant="default">
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
      Export full system (Excel)
    </Button>
  );
}

// ---------------- Single merged file: name/sku + multiple barcodes ----------------

function SingleMergedFile() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ headers: string[]; rows: Record<string, any>[]; name: string } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ products: number; barcodes: number; failed: number; errors: string[] } | null>(null);
  const [autoSave, setAutoSave] = useState(false);
  const [wiping, setWiping] = useState(false);
  const autoRanFor = useRef<string | null>(null);

  const FIELDS = [
    { key: "name", label: "Item Name", required: true },
    { key: "sku", label: "Item Code / SKU" },
    { key: "barcode", label: "Barcode(s) — comma/space separated ok" },
    { key: "category", label: "Category" },
    { key: "unit", label: "Unit" },
    { key: "cost_price", label: "Purchase Rate" },
    { key: "sell_price", label: "Sale Rate" },
    { key: "stock", label: "Stock" },
    { key: "tax_rate", label: "Tax %" },
  ];

  const pickFile = async (f: File) => {
    try {
      const parsed = await parseSpreadsheet(f);
      if (!parsed.rows.length) return toast.error("File empty ya headers nahi mile");
      setFile({ ...parsed, name: f.name });
      setMapping(smartAutoMap(parsed.headers, parsed.rows));
      toast.success(`Parsed ${parsed.rows.length} rows from ${f.name}`);
    } catch (e: any) { toast.error(`Read failed: ${e.message}`); }
  };

  // Group rows by key = sku (preferred) or normalized name+category
  const grouped = useMemo(() => {
    if (!file) return [] as any[];
    const num = (v: any) => Number(String(v ?? "").replace(/[^0-9.\-]/g, "")) || 0;
    const splitBC = (s: string) => s.split(/[\s,;|/]+/g).map((x) => x.trim()).filter(Boolean);
    const groups = new Map<string, any>();
    for (const r of file.rows) {
      const name = String(r[mapping.name ?? ""] ?? "").trim();
      if (!name) continue;
      const sku = mapping.sku ? String(r[mapping.sku] ?? "").trim() : "";
      const cat = mapping.category ? String(r[mapping.category] ?? "").trim() : "";
      const key = sku ? `sku:${sku}` : `nm:${name.toLowerCase()}|${cat.toLowerCase()}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          name, sku: sku || null,
          category: cat || null,
          unit: mapping.unit ? String(r[mapping.unit] ?? "").trim() || null : null,
          cost_price: mapping.cost_price ? num(r[mapping.cost_price]) : 0,
          sell_price: mapping.sell_price ? num(r[mapping.sell_price]) : 0,
          stock: mapping.stock ? num(r[mapping.stock]) : 0,
          tax_rate: mapping.tax_rate ? num(r[mapping.tax_rate]) : 0,
          barcodes: new Set<string>(),
        };
        groups.set(key, g);
      } else {
        // fill missing values from later rows
        if (!g.category && mapping.category) g.category = String(r[mapping.category] ?? "").trim() || null;
        if (!g.unit && mapping.unit) g.unit = String(r[mapping.unit] ?? "").trim() || null;
        if (!g.cost_price && mapping.cost_price) g.cost_price = num(r[mapping.cost_price]);
        if (!g.sell_price && mapping.sell_price) g.sell_price = num(r[mapping.sell_price]);
        if (!g.stock && mapping.stock) g.stock = num(r[mapping.stock]);
      }
      if (mapping.barcode) {
        for (const b of splitBC(String(r[mapping.barcode] ?? ""))) g.barcodes.add(b);
      }
    }
    return [...groups.values()].map((g) => ({ ...g, barcodes: [...g.barcodes] }));
  }, [file, mapping]);

  const totalBarcodes = useMemo(() => grouped.reduce((s, g) => s + g.barcodes.length, 0), [grouped]);

  const runImport = async () => {
    if (!grouped.length) return toast.error("Koi valid rows nahi mili");
    setBusy(true); setResult({ products: 0, barcodes: 0, failed: 0, errors: [] });
    const errors: string[] = [];
    let prodOk = 0, prodFail = 0, bcOk = 0;
    const chunkSize = 200;

    // Track this upload as a batch so it appears in "Uploaded files"
    // and can be deleted later along with its imported rows.
    const batchId = await createImportBatch(file?.name ?? "merged-upload", "single_merged");

    // Split by whether SKU present
    const withSku = grouped.filter((g) => g.sku);
    const noSku = grouped.filter((g) => !g.sku);

    // Prepare product rows (drop barcodes array; set primary barcode = first)
    const toProduct = (g: any) => ({
      name: g.name, sku: g.sku, category: g.category, unit: g.unit || "pcs",
      cost_price: g.cost_price, sell_price: g.sell_price, stock: g.stock, tax_rate: g.tax_rate,
      barcode: g.barcodes[0] ?? null,
      ...(batchId ? { import_batch_id: batchId } : {}),
    });

    // 1) Upsert products with SKU (grouped so no dupes in one batch)
    for (let i = 0; i < withSku.length; i += chunkSize) {
      const chunk = withSku.slice(i, i + chunkSize).map(toProduct);
      const { error } = await supabase.from("products").upsert(chunk as any, { onConflict: "sku" });
      if (error) { prodFail += chunk.length; errors.push(error.message); } else prodOk += chunk.length;
      setResult({ products: prodOk, barcodes: bcOk, failed: prodFail, errors: [...new Set(errors)].slice(0, 5) });
    }
    // 2) Insert products without SKU
    for (let i = 0; i < noSku.length; i += chunkSize) {
      const chunk = noSku.slice(i, i + chunkSize).map(toProduct);
      const { error } = await supabase.from("products").insert(chunk as any);
      if (error) { prodFail += chunk.length; errors.push(error.message); } else prodOk += chunk.length;
      setResult({ products: prodOk, barcodes: bcOk, failed: prodFail, errors: [...new Set(errors)].slice(0, 5) });
    }

    // 3) Resolve product IDs — lookup by SKU (bulk) and by name (bulk) for no-SKU items
    const skuList = withSku.map((g) => g.sku!).filter(Boolean);
    const skuToId: Record<string, string> = {};
    for (let i = 0; i < skuList.length; i += 500) {
      const slice = skuList.slice(i, i + 500);
      const { data } = await supabase.from("products").select("id, sku").in("sku", slice);
      (data ?? []).forEach((p: any) => { if (p.sku) skuToId[p.sku] = p.id; });
    }
    const nameToId: Record<string, string> = {};
    if (noSku.length) {
      const names = [...new Set(noSku.map((g) => g.name))];
      for (let i = 0; i < names.length; i += 500) {
        const slice = names.slice(i, i + 500);
        const { data } = await supabase.from("products").select("id, name").in("name", slice);
        (data ?? []).forEach((p: any) => { nameToId[p.name] = p.id; });
      }
    }

    // 4) Upsert all barcodes
    const bcRows: { product_id: string; barcode: string; import_batch_id?: string }[] = [];
    for (const g of grouped) {
      const pid = g.sku ? skuToId[g.sku] : nameToId[g.name];
      if (!pid) continue;
      for (const b of g.barcodes) bcRows.push({
        product_id: pid, barcode: b,
        ...(batchId ? { import_batch_id: batchId } : {}),
      });
    }
    // De-dupe by barcode
    const seen = new Set<string>();
    const uniqueBC = bcRows.filter((r) => (seen.has(r.barcode) ? false : (seen.add(r.barcode), true)));
    for (let i = 0; i < uniqueBC.length; i += chunkSize) {
      const chunk = uniqueBC.slice(i, i + chunkSize);
      const { error } = await supabase.from("product_barcodes").upsert(chunk as any, { onConflict: "barcode", ignoreDuplicates: false });
      if (error) errors.push(`barcodes: ${error.message}`); else bcOk += chunk.length;
      setResult({ products: prodOk, barcodes: bcOk, failed: prodFail, errors: [...new Set(errors)].slice(0, 5) });
    }

    await finalizeImportBatch(batchId, { products: prodOk, barcodes: bcOk, failed: prodFail });
    notifyBatchChanged();
    invalidateAfterImport(qc);

    setBusy(false);
    if (prodFail === 0) toast.success(`Imported ${prodOk} items · ${bcOk} barcodes linked`);
    else toast.error(`${prodOk} imported, ${prodFail} failed`);
  };

  // Auto-save: as soon as file is parsed and required "name" column is mapped,
  // run the import once automatically (unless user turned auto-save off).
  useEffect(() => {
    if (!autoSave || !file || busy) return;
    if (!mapping.name) return;
    if (!grouped.length) return;
    const key = `${file.name}:${file.rows.length}`;
    if (autoRanFor.current === key) return;
    autoRanFor.current = key;
    runImport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, mapping, grouped, autoSave]);

  const wipeAll = async () => {
    if (!confirm("Saare imported products aur barcodes delete kar diye jaen ge. Sales/purchases history rahegi. Continue?")) return;
    setWiping(true);
    try {
      const { error: e1 } = await supabase.from("product_barcodes").delete().not("id", "is", null);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("products").delete().not("id", "is", null);
      if (e2) throw e2;
      // Also wipe the batch history for product uploads so counts stay in sync.
      await supabase.from("import_batches").delete().in("source", ["single_merged", "smart_merge", "products"]);
      notifyBatchChanged();
      invalidateAfterImport(qc);
      toast.success("Sab imported stock delete ho gaya. Ab dobara file upload karen.");
    } catch (e: any) {
      toast.error(e.message ?? "Wipe failed");
    } finally { setWiping(false); }
  };

  // Small helper: show first non-empty sample of a header
  const sampleFor = (h: string | undefined | null): string => {
    if (!h || !file) return "";
    for (const r of file.rows) {
      const v = r[h];
      if (v !== null && v !== undefined && String(v).trim() !== "") return String(v).trim().slice(0, 40);
    }
    return "";
  };


  return (
    <div className="space-y-4">
      <Alert>
        <FileSpreadsheet className="h-4 w-4" />
        <AlertDescription className="text-xs">
          <b>Aik hi file</b> upload karen jis me item name, item code aur barcodes hon. Same item ke multiple barcodes ho sakty hain —
          ya to alag alag rows me (same SKU/Name), ya aik hi cell me comma/space se separated. System khud group kar dega.
          <b> Existing SKU update hoga, naye add ho jain ge.</b>
        </AlertDescription>
      </Alert>

      <Card className="p-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-medium">Step 1 — Upload file</h3>
          <p className="text-xs text-muted-foreground">{file ? `${file.name} · ${file.rows.length} rows` : "Excel (.xlsx, .xls) ya CSV"}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
            <input type="checkbox" checked={autoSave} onChange={(e) => setAutoSave(e.target.checked)} />
            Auto-save on upload
          </label>
          <Button variant="destructive" size="sm" onClick={wipeAll} disabled={wiping}>
            {wiping ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <AlertCircle className="h-4 w-4 mr-1" />}
            Wipe imported stock
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
          <Button onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2" />Choose file</Button>
          {file && <Button variant="outline" onClick={() => { setFile(null); setMapping({}); setResult(null); autoRanFor.current = null; }}>Clear</Button>}
        </div>
      </Card>

      {file && (
        <Card className="p-4 space-y-3">
          <h3 className="font-medium">Step 2 — Map columns <span className="text-xs text-muted-foreground font-normal">(smart auto-detect · sample dikha raha hy taake foran verify kar saken)</span></h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FIELDS.map((f) => {
              const src = mapping[f.key];
              const sample = sampleFor(src);
              return (
                <div key={f.key} className="space-y-1">
                  <Label className="text-xs">
                    {f.label} {f.required && <span className="text-destructive">*</span>}
                    {src && <Badge variant="secondary" className="ml-2">auto</Badge>}
                  </Label>
                  <Select value={src ?? "__none__"} onValueChange={(v) => setMapping({ ...mapping, [f.key]: v === "__none__" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="— skip —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— skip —</SelectItem>
                      {file.headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {src && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      sample: <span className="font-mono">{sample || "(empty)"}</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {grouped.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-medium">Step 3 — Preview</h3>
              <p className="text-xs text-muted-foreground">
                {grouped.length} unique items · {totalBarcodes} barcodes total
                {file && ` (from ${file.rows.length} rows — grouped by ${mapping.sku ? "SKU" : "Name"})`}
              </p>
            </div>
            <Button onClick={runImport} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Import {grouped.length} items
            </Button>
          </div>
          <div className="max-h-80 overflow-auto border rounded">
            <Table>
              <TableHeader><TableRow>
                <TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead>Barcodes</TableHead>
                <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Sale</TableHead><TableHead className="text-right">Stock</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {grouped.slice(0, 100).map((g, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{g.sku ?? "—"}</TableCell>
                    <TableCell className="text-xs">{g.name}</TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-wrap gap-1">
                        {g.barcodes.slice(0, 4).map((b: string) => <Badge key={b} variant="outline" className="font-mono text-[10px]">{b}</Badge>)}
                        {g.barcodes.length > 4 && <span className="text-muted-foreground">+{g.barcodes.length - 4}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-right">{g.cost_price}</TableCell>
                    <TableCell className="text-xs text-right">{g.sell_price}</TableCell>
                    <TableCell className="text-xs text-right">{g.stock}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {grouped.length > 100 && <p className="text-xs text-muted-foreground">Showing first 100 of {grouped.length}.</p>}
        </Card>
      )}

      {result && (
        <Alert variant={result.failed > 0 ? "destructive" : "default"}>
          {result.failed === 0 ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertDescription>
            <div><b>{result.products}</b> items imported · <b>{result.barcodes}</b> barcodes linked · <b>{result.failed}</b> failed.</div>
            {result.errors.length > 0 && <ul className="mt-2 text-xs list-disc pl-4">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
