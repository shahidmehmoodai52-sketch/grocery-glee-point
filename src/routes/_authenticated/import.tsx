import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Upload, FileDown, CheckCircle2, AlertCircle, Loader2, Database, FileSpreadsheet, Wand2 } from "lucide-react";
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
        </TabsList>
        <TabsContent value="single" className="mt-4"><SingleMergedFile /></TabsContent>
        <TabsContent value="smart" className="mt-4"><SmartMerge /></TabsContent>
        {(["products", "customers", "suppliers"] as EntityKey[]).map((k) => (
          <TabsContent key={k} value={k} className="mt-4">
            <Importer entity={k} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
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

function SmartMerge() {
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

    // 1) Upsert products by SKU (when present)
    const chunkSize = 200;
    const withSku = merged.filter((p) => p.sku);
    const noSku = merged.filter((p) => !p.sku);
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
        .map((x) => ({ product_id: skuToId[x.sku], barcode: x.barcode }))
        .filter((x) => x.product_id);
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase.from("product_barcodes").upsert(chunk as any, { onConflict: "barcode" });
        if (error) errors.push(error.message); else bcOk += chunk.length;
      }
    }

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
  const schema = SCHEMAS[entity];
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: number; errors: string[] } | null>(null);

  const parseFile = async (file: File) => {
    setResult(null);
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
    for (let i = 0; i < mapped.length; i += chunkSize) {
      const chunk = mapped.slice(i, i + chunkSize);
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
            <Button onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2" />Choose file</Button>
          </div>
        </div>
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ headers: string[]; rows: Record<string, any>[]; name: string } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ products: number; barcodes: number; failed: number; errors: string[] } | null>(null);

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
      setMapping(autoMap(parsed.headers));
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

    // Split by whether SKU present
    const withSku = grouped.filter((g) => g.sku);
    const noSku = grouped.filter((g) => !g.sku);

    // Prepare product rows (drop barcodes array; set primary barcode = first)
    const toProduct = (g: any) => ({
      name: g.name, sku: g.sku, category: g.category, unit: g.unit || "pcs",
      cost_price: g.cost_price, sell_price: g.sell_price, stock: g.stock, tax_rate: g.tax_rate,
      barcode: g.barcodes[0] ?? null,
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
    const bcRows: { product_id: string; barcode: string }[] = [];
    for (const g of grouped) {
      const pid = g.sku ? skuToId[g.sku] : nameToId[g.name];
      if (!pid) continue;
      for (const b of g.barcodes) bcRows.push({ product_id: pid, barcode: b });
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

    setBusy(false);
    if (prodFail === 0) toast.success(`Imported ${prodOk} items · ${bcOk} barcodes linked`);
    else toast.error(`${prodOk} imported, ${prodFail} failed`);
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
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
          <Button onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2" />Choose file</Button>
          {file && <Button variant="outline" onClick={() => { setFile(null); setMapping({}); setResult(null); }}>Clear</Button>}
        </div>
      </Card>

      {file && (
        <Card className="p-4 space-y-3">
          <h3 className="font-medium">Step 2 — Map columns</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">
                  {f.label} {f.required && <span className="text-destructive">*</span>}
                  {mapping[f.key] && <Badge variant="secondary" className="ml-2">auto</Badge>}
                </Label>
                <Select value={mapping[f.key] ?? "__none__"} onValueChange={(v) => setMapping({ ...mapping, [f.key]: v === "__none__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="— skip —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— skip —</SelectItem>
                    {file.headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
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
