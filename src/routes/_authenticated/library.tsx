import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Library, Search, Download, Check, X, Clock, ShieldCheck, Plus, Upload } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/use-permissions";
import { fetchAll } from "@/lib/supabase-page";

export const Route = createFileRoute("/_authenticated/library")({
  component: LibraryPage,
});

type GlobalProduct = {
  id: string;
  name: string;
  barcode: string | null;
  category: string | null;
  unit: string | null;
  image_url: string | null;
  description: string | null;
  status: string;
  contributed_by_tenant: string | null;
  contributed_by_user: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
};

function LibraryPage() {
  const qc = useQueryClient();
  const { isSuperAdmin } = usePermissions();
  const [tab, setTab] = useState<"browse" | "queue" | "mine">("browse");
  const [search, setSearch] = useState("");

  // Is this shop allowed to use the developer's library?
  const { data: libraryAccess } = useQuery({
    queryKey: ["library-access"],
    queryFn: async () => {
      if (isSuperAdmin) return true;
      const { data } = await supabase.rpc("current_tenant_id");
      const tid = data as string | null;
      if (!tid) return false;
      const { data: t } = await supabase
        .from("tenants")
        .select("library_approved")
        .eq("id", tid)
        .maybeSingle();
      return !!t?.library_approved;
    },
  });
  const hasAccess = !!libraryAccess;

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["global_products", tab],
    enabled: hasAccess || isSuperAdmin,
    queryFn: async () => {
      const rows = await fetchAll<GlobalProduct>((from, to) => {
        let q = supabase.from("global_products").select("*").order("created_at", { ascending: false });
        if (tab === "browse") q = q.eq("status", "approved");
        else if (tab === "queue") q = q.eq("status", "pending");
        return q.range(from, to);
      });
      return rows;
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.barcode ?? "").toLowerCase().includes(q) ||
        (it.category ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["global_products"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const approve = async (id: string) => {
    const { error } = await supabase.from("global_products").update({ status: "approved" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Approved");
    invalidate();
  };

  const reject = async (id: string) => {
    const notes = window.prompt("Reason for rejection (optional)") ?? "";
    const { error } = await supabase
      .from("global_products")
      .update({ status: "rejected", review_notes: notes || null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Rejected");
    invalidate();
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Global product library"
        description={
          isSuperAdmin
            ? "Developer-managed catalog. Items you upload become available to shops you grant access to."
            : "Ready-made product list from the developer. Import items, set your own sale and purchase price, and start billing."
        }
        icon={<Library className="h-5 w-5" />}
        actions={
          isSuperAdmin ? (
            <div className="flex gap-2">
              <BulkUploadDialog onDone={invalidate} />
              <ContributeDialog onDone={invalidate} />
            </div>
          ) : null
        }
      />

      {!isSuperAdmin && !hasAccess && (
        <Card className="p-6">
          <EmptyState
            icon={Library}
            title="Library access not enabled"
            description="Your shop hasn't been granted access to the global product library yet. Please contact the developer to enable it for your shop."
          />
        </Card>
      )}

      {(isSuperAdmin || hasAccess) && (
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="browse">
            <ShieldCheck className="h-4 w-4 mr-1" /> Approved
          </TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="queue">
              <Clock className="h-4 w-4 mr-1" /> Review queue
            </TabsTrigger>
          )}
          {isSuperAdmin && (
            <TabsTrigger value="mine">My uploads</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="browse">
          <LibraryTable
            items={filtered}
            isLoading={isLoading}
            search={search}
            setSearch={setSearch}
            mode="import"
            onDone={invalidate}
          />
        </TabsContent>

        {isSuperAdmin && (
          <TabsContent value="queue">
            <LibraryTable
              items={filtered}
              isLoading={isLoading}
              search={search}
              setSearch={setSearch}
              mode="review"
              onApprove={approve}
              onReject={reject}
            />
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="mine">
            <MineTable search={search} setSearch={setSearch} />
          </TabsContent>
        )}
      </Tabs>
      )}
    </div>
  );
}

function LibraryTable({
  items,
  isLoading,
  search,
  setSearch,
  mode,
  onApprove,
  onReject,
  onDone,
}: {
  items: GlobalProduct[];
  isLoading: boolean;
  search: string;
  setSearch: (v: string) => void;
  mode: "import" | "review";
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onDone?: () => void;
}) {
  return (
    <Card className="p-3 mt-3">
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, barcode, category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Barcode</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={6} className="py-4">
                <TableSkeleton rows={5} columns={6} />
              </TableCell>
            </TableRow>
          )}
          {!isLoading && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8">
                <EmptyState
                  icon={Library}
                  title="Nothing here yet"
                  description={
                    mode === "review"
                      ? "No pending contributions to review."
                      : "No approved items match your search."
                  }
                />
              </TableCell>
            </TableRow>
          )}
          {items.map((it) => (
            <TableRow key={it.id}>
              <TableCell className="font-medium">{it.name}</TableCell>
              <TableCell className="text-muted-foreground">{it.barcode ?? "—"}</TableCell>
              <TableCell>{it.category ?? "—"}</TableCell>
              <TableCell>{it.unit ?? "pcs"}</TableCell>
              <TableCell>
                {it.status === "approved" && <StatusBadge tone="success">Approved</StatusBadge>}
                {it.status === "pending" && <StatusBadge tone="warning">Pending</StatusBadge>}
                {it.status === "rejected" && <StatusBadge tone="danger">Rejected</StatusBadge>}
              </TableCell>
              <TableCell className="text-right">
                {mode === "import" && <ImportButton item={it} onDone={onDone} />}
                {mode === "review" && (
                  <div className="inline-flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => onApprove?.(it.id)}>
                      <Check className="h-4 w-4 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onReject?.(it.id)}>
                      <X className="h-4 w-4 mr-1 text-destructive" /> Reject
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function MineTable({ search, setSearch }: { search: string; setSearch: (v: string) => void }) {
  const { data: uid } = useQuery({
    queryKey: ["auth-uid"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    staleTime: 60_000,
  });
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["global_products", "mine", uid],
    enabled: !!uid,
    queryFn: async () =>
      fetchAll<GlobalProduct>((from, to) =>
        supabase
          .from("global_products")
          .select("*")
          .eq("contributed_by_user", uid!)
          .order("created_at", { ascending: false })
          .range(from, to),
      ),
  });
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.barcode ?? "").toLowerCase().includes(q) ||
        (it.category ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);
  return (
    <LibraryTable
      items={filtered}
      isLoading={isLoading}
      search={search}
      setSearch={setSearch}
      mode="import"
    />
  );
}

function ImportButton({ item, onDone }: { item: GlobalProduct; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [sell, setSell] = useState(0);
  const [cost, setCost] = useState(0);
  const [stock, setStock] = useState(0);
  const [busy, setBusy] = useState(false);
  const doImport = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("import_from_global_library", {
      _global_id: item.id,
      _sell_price: sell,
      _cost_price: cost,
      _stock: stock,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Imported "${item.name}" to your catalog`);
    setOpen(false);
    onDone?.();
  };
  if (item.status !== "approved") return <span className="text-xs text-muted-foreground">Awaiting approval</span>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="h-4 w-4 mr-1" /> Import
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import "{item.name}" to your shop</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          The name, barcode, category, and unit come from the shared library. Set your own price and stock — these stay
          private to your shop.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Cost</Label>
            <Input type="number" step="0.01" value={cost} onChange={(e) => setCost(Number(e.target.value))} />
          </div>
          <div>
            <Label>Sell price</Label>
            <Input type="number" step="0.01" value={sell} onChange={(e) => setSell(Number(e.target.value))} />
          </div>
          <div>
            <Label>Opening stock</Label>
            <Input type="number" step="0.001" value={stock} onChange={(e) => setStock(Number(e.target.value))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={busy} onClick={doImport}>{busy ? "Importing…" : "Import"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContributeDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return toast.error("Name is required");
    setBusy(true);
    const { error } = await supabase.from("global_products").insert({
      name: name.trim(),
      barcode: barcode.trim() || null,
      category: category.trim() || null,
      unit: unit.trim() || "pcs",
      description: description.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Submitted for admin approval");
    setOpen(false);
    setName(""); setBarcode(""); setCategory(""); setUnit("pcs"); setDescription("");
    onDone();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" />Contribute item</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contribute to global library</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Only metadata is shared (name, barcode, category, unit). Your prices and stock never leave your shop. An
          admin must approve before it appears to other shops.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Barcode</Label>
            <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </div>
          <div>
            <Label>Unit</Label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Notes (optional)</Label>
            <textarea
              className="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit for approval"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Map various header names -> our canonical fields
function pickField(row: Record<string, any>, keys: string[]): string | null {
  const lowered: Record<string, any> = {};
  for (const k of Object.keys(row)) lowered[k.trim().toLowerCase()] = row[k];
  for (const k of keys) {
    const v = lowered[k.toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

async function parseFile(file: File): Promise<Record<string, any>[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data as any[]),
        error: reject,
      });
    });
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function BulkUploadDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [progress, setProgress] = useState<{ ok: number; skipped: number; failed: number } | null>(null);

  const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setProgress(null);
    setStage("Reading file…");
    try {
      // Let the UI paint before the heavy synchronous parse.
      await yieldToUI();
      const rows = await parseFile(file);
      setStage(`Processing ${rows.length} rows…`);
      await yieldToUI();

      const cleaned: Array<{ name: string; barcode: string; category: string | null; unit: string }> = [];
      const seen = new Set<string>();
      let skipped = 0;
      let dupInFile = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const nm = pickField(r, ["name", "product name", "item", "item name", "title"]);
        const bc = pickField(r, ["barcode", "ean", "upc", "code", "sku"]);
        if (!nm || !bc) { skipped++; }
        else if (seen.has(bc)) { dupInFile++; }
        else {
          seen.add(bc);
          cleaned.push({
            name: nm,
            barcode: bc,
            category: pickField(r, ["category", "cat", "group"]),
            unit: pickField(r, ["unit", "uom", "unit type"]) ?? "pcs",
          });
        }
        // Yield periodically so the UI doesn't freeze on large files.
        if (i % 2000 === 1999) {
          setStage(`Processing rows… ${i + 1}/${rows.length}`);
          await yieldToUI();
        }
      }
      if (cleaned.length === 0) {
        toast.error(`No valid rows found. Required: name + barcode. Skipped: ${skipped}`);
        setBusy(false);
        setStage("");
        return;
      }

      setStage("Checking existing barcodes…");
      await yieldToUI();
      let alreadyExists = 0;
      const barcodes = cleaned.map((c) => c.barcode);
      const existing = new Set<string>();
      const lookupChunk = 500;
      for (let i = 0; i < barcodes.length; i += lookupChunk) {
        const slice = barcodes.slice(i, i + lookupChunk);
        const { data, error } = await supabase
          .from("global_products")
          .select("barcode")
          .in("barcode", slice);
        if (!error && data) for (const row of data) if (row.barcode) existing.add(row.barcode);
        setStage(`Checking existing… ${Math.min(i + lookupChunk, barcodes.length)}/${barcodes.length}`);
        setProgress({ ok: 0, skipped: skipped + dupInFile, failed: 0 });
        await yieldToUI();
      }
      const toInsert = cleaned.filter((c) => {
        if (existing.has(c.barcode)) { alreadyExists++; return false; }
        return true;
      });

      let ok = 0;
      let failed = 0;
      const chunk = 200;
      setStage(`Uploading ${toInsert.length} items…`);
      await yieldToUI();
      for (let i = 0; i < toInsert.length; i += chunk) {
        const slice = toInsert.slice(i, i + chunk);
        const { error, count } = await supabase
          .from("global_products")
          .insert(slice, { count: "exact" });
        if (error) {
          for (const row of slice) {
            const { error: e2 } = await supabase.from("global_products").insert(row);
            if (e2) failed++; else ok++;
          }
        } else {
          ok += count ?? slice.length;
        }
        setProgress({ ok, skipped: skipped + dupInFile + alreadyExists, failed });
        setStage(`Uploading… ${Math.min(i + chunk, toInsert.length)}/${toInsert.length}`);
        await yieldToUI();
      }
      toast.success(
        `Uploaded ${ok} · Skipped ${skipped + dupInFile + alreadyExists} (${skipped} missing, ${dupInFile} dup in file, ${alreadyExists} already in library) · Failed ${failed}`,
      );
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to parse file");
    } finally {
      setBusy(false);
      setStage("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Upload className="h-4 w-4 mr-2" />Upload file</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk upload to global library</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Upload a CSV or Excel file. Only these columns are read — everything else is ignored:
          <br />
          <strong>name</strong> (required), <strong>barcode</strong> (required), <strong>category</strong>, <strong>unit</strong>.
          <br />
          Rows without a name or barcode are skipped. Items are submitted as <em>pending</em> and need admin approval.
        </p>
        <div>
          <Label>Choose file (.csv, .xlsx, .xls)</Label>
          <Input
            type="file"
            accept=".csv,.txt,.xlsx,.xls"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              // Reset so selecting the same file again re-triggers onChange.
              e.target.value = "";
              handleFile(f);
            }}
          />
        </div>
        {busy && stage && (
          <div className="text-sm text-muted-foreground">{stage}</div>
        )}
        {progress && (
          <div className="text-sm text-muted-foreground">
            Uploaded: {progress.ok} · Skipped: {progress.skipped} · Failed: {progress.failed}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            {busy ? "Uploading…" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
