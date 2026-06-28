import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Upload, FileDown, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/import")({ component: Page });

type EntityKey = "products" | "customers" | "suppliers";

const SCHEMAS: Record<EntityKey, { fields: { key: string; label: string; required?: boolean; type?: "number" | "bool" }[]; sample: string; onConflict?: string }> = {
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
    sample: "name,sku,barcode,category,unit,cost_price,sell_price,stock,tax_rate\nSugar 1kg,SUG001,8964000111111,Grocery,pcs,120,140,50,0\nRice 5kg,RIC005,8964000222222,Grocery,pcs,1100,1250,20,0\n",
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
    sample: "name,phone,email,address,balance\nAhmed Khan,03001234567,ahmed@example.com,Lahore,0\nWalk-in Regular,,,,0\n",
  },
  suppliers: {
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "address", label: "Address" },
      { key: "balance", label: "Opening Balance (we owe)", type: "number" },
    ],
    sample: "name,phone,email,address,balance\nMetro Wholesale,0429876543,info@metro.pk,Lahore,0\n",
  },
};

function Page() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Bulk import</h1>
        <p className="text-sm text-muted-foreground">Migrate from your old POS. Upload CSV files for products, customers, and suppliers — no single-by-single entry needed.</p>
      </div>

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products & Stock</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
        </TabsList>
        {(["products", "customers", "suppliers"] as EntityKey[]).map((k) => (
          <TabsContent key={k} value={k} className="mt-4">
            <Importer entity={k} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function Importer({ entity }: { entity: EntityKey }) {
  const schema = SCHEMAS[entity];
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: number; errors: string[] } | null>(null);

  const parseFile = (file: File) => {
    setResult(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data as Record<string, any>[];
        const hdrs = res.meta.fields ?? [];
        setHeaders(hdrs);
        setRows(data);
        // Auto-map by name similarity
        const auto: Record<string, string> = {};
        schema.fields.forEach((f) => {
          const hit = hdrs.find((h) => h.toLowerCase().replace(/[^a-z]/g, "") === f.key.replace(/[^a-z]/g, ""))
            || hdrs.find((h) => h.toLowerCase().includes(f.key.split("_")[0]));
          if (hit) auto[f.key] = hit;
        });
        setMapping(auto);
        toast.success(`Parsed ${data.length} rows`);
      },
      error: (e) => toast.error(e.message),
    });
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
    const blob = new Blob([schema.sample], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${entity}-sample.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const runImport = async () => {
    if (mapped.length === 0) return toast.error("No rows to import");
    setBusy(true); setResult({ ok: 0, failed: 0, errors: [] });
    const errors: string[] = [];
    let ok = 0, failed = 0;
    const chunkSize = 200;
    for (let i = 0; i < mapped.length; i += chunkSize) {
      const chunk = mapped.slice(i, i + chunkSize);
      let q = supabase.from(entity).insert(chunk as any);
      if (entity === "products" && schema.onConflict) {
        // Upsert on SKU when present, else just insert. Split rows.
        const withKey = chunk.filter((r) => r.sku);
        const withoutKey = chunk.filter((r) => !r.sku);
        const ops: Promise<any>[] = [];
        if (withKey.length) ops.push(supabase.from("products").upsert(withKey as any, { onConflict: "sku" }));
        if (withoutKey.length) ops.push(supabase.from("products").insert(withoutKey as any));
        const results = await Promise.all(ops);
        results.forEach((r, idx) => {
          if (r.error) { failed += idx === 0 ? withKey.length : withoutKey.length; errors.push(r.error.message); }
          else ok += idx === 0 ? withKey.length : withoutKey.length;
        });
      } else {
        const { error } = await q;
        if (error) { failed += chunk.length; errors.push(error.message); }
        else ok += chunk.length;
      }
      setResult({ ok, failed, errors: [...new Set(errors)].slice(0, 5) });
    }
    setBusy(false);
    if (failed === 0) toast.success(`Imported ${ok} rows`);
    else toast.error(`${ok} imported, ${failed} failed`);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-medium">Step 1 — Upload CSV</h3>
            <p className="text-xs text-muted-foreground">Export from your old POS as CSV (UTF-8). Headers in first row.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadSample}><FileDown className="h-4 w-4 mr-2" />Sample CSV</Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
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
                <Label className="text-xs">
                  {f.label} {f.required && <span className="text-destructive">*</span>}
                </Label>
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
              Rows with matching <b>SKU</b> will be updated (stock & prices overwritten). Rows without SKU are added as new.
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
          {mapped.length > 50 && <p className="text-xs text-muted-foreground">Showing first 50 of {mapped.length}.</p>}
        </Card>
      )}

      {result && (
        <Alert variant={result.failed > 0 ? "destructive" : "default"}>
          {result.failed === 0 ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertDescription>
            <div><b>{result.ok}</b> imported, <b>{result.failed}</b> failed.</div>
            {result.errors.length > 0 && (
              <ul className="mt-2 text-xs list-disc pl-4">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
