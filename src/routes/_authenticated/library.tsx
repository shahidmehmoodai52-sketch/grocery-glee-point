import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Library, Search, Download, Check, X, Clock, ShieldCheck, Plus, Upload } from "lucide-react";

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
import { usePriceVisibility } from "@/hooks/use-price-visibility";
import { fetchAll } from "@/lib/supabase-page";
import { NeedsInternetBanner } from "@/components/needs-internet-banner";

export const Route = createFileRoute("/_authenticated/library")({
  component: LibraryPage,
});

type GlobalProduct = {
  id: string;
  name: string;
  barcode: string | null;
  item_code: string | null;
  category: string | null;
  unit: string | null;
  image_url: string | null;
  description: string | null;
  default_sell_price: number | null;
  default_cost_price: number | null;
  status: string;
  contributed_by_tenant: string | null;
  contributed_by_user: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
};

function LibraryPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { isSuperAdmin } = usePermissions();
  const [tab, setTab] = useState<"browse" | "queue" | "mine">("browse");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: prefs } = usePriceVisibility();
  const hasAccess = !!prefs?.hasAccess;
  const showSell = prefs?.showSell ?? true;
  const showCost = prefs?.showCost ?? true;

  const PAGE_LIMIT = 300;

  const { data: items = [], isLoading, isFetching } = useQuery({
    queryKey: ["global_products", tab, debounced],
    enabled: hasAccess || isSuperAdmin,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("global_products")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(PAGE_LIMIT);
      if (tab === "browse") q = q.eq("status", "approved");
      else if (tab === "queue") q = q.eq("status", "pending");
      if (debounced) {
        const term = debounced.replace(/[,%()]/g, " ").trim();
        q = q.or(
          `name.ilike.%${term}%,barcode.ilike.%${term}%,item_code.ilike.%${term}%,category.ilike.%${term}%`,
        );
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as GlobalProduct[];
    },
  });

  // Server-side search already applied; keep local list as-is.
  const filtered = items;

  const invalidateAfterImport = () => {
    // Import doesn't change the library list itself — only the shop's products.
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["dash-products"] });
  };

  const invalidateAfterReview = () => {
    qc.invalidateQueries({ queryKey: ["global_products"] });
  };

  const approve = async (id: string) => {
    const { error } = await supabase.from("global_products").update({ status: "approved" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t('library.toast_approved', 'Approved'));
    invalidateAfterReview();
  };

  const reject = async (id: string) => {
    const notes = window.prompt(t('library.reject_reason_prompt', 'Reason for rejection (optional)')) ?? "";
    const { error } = await supabase
      .from("global_products")
      .update({ status: "rejected", review_notes: notes || null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t('library.toast_rejected', 'Rejected'));
    invalidateAfterReview();
  };


  return (
    <div className="p-6 space-y-4">
      <NeedsInternetBanner section={t('library.page_title', 'Global product library')} />
      <PageHeader
        title={t('library.page_title', 'Global product library')}
        description={
          isSuperAdmin
            ? t('library.page_desc_super', 'Developer-managed catalog. Items you upload become available to shops you grant access to.')
            : t('library.page_desc_shop', 'Ready-made product list from the developer. Import items, set your own sale and purchase price, and start billing.')
        }
        icon={<Library className="h-5 w-5" />}
        actions={
          <div className="flex gap-2">
            {!isSuperAdmin && hasAccess && <ImportAllButton onDone={invalidateAfterImport} />}
            {isSuperAdmin && <BulkUploadDialog onDone={invalidateAfterReview} />}
            {(isSuperAdmin || hasAccess) && <ContributeDialog onDone={invalidateAfterReview} />}
          </div>
        }
      />

      {!isSuperAdmin && !hasAccess && (
        <Card className="p-6">
          <EmptyState
            icon={Library}
            title={t('library.access_not_enabled_title', 'Library access not enabled')}
            description={t('library.access_not_enabled_desc', "Your shop hasn't been granted access to the global product library yet. Please contact the developer to enable it for your shop.")}
          />
        </Card>
      )}

      {(isSuperAdmin || hasAccess) && (
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="browse">
            <ShieldCheck className="h-4 w-4 mr-1" /> {t('library.tab_approved', 'Approved')}
          </TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="queue">
              <Clock className="h-4 w-4 mr-1" /> {t('library.tab_review_queue', 'Review queue')}
            </TabsTrigger>
          )}
          {(isSuperAdmin || hasAccess) && (
            <TabsTrigger value="mine">{t('library.tab_my_uploads', 'My uploads')}</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="browse">
          <LibraryTable
            items={filtered}
            isLoading={isLoading}
            search={search}
            setSearch={setSearch}
            mode="import"
            onDone={invalidateAfterImport}
            showSell={showSell}
            showCost={showCost}
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
              showSell={showSell}
              showCost={showCost}
            />
          </TabsContent>
        )}

        {(isSuperAdmin || hasAccess) && (
          <TabsContent value="mine">
            <MineTable search={search} setSearch={setSearch} showSell={showSell} showCost={showCost} />
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
  showSell = true,
  showCost = true,
}: {
  items: GlobalProduct[];
  isLoading: boolean;
  search: string;
  setSearch: (v: string) => void;
  mode: "import" | "review";
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onDone?: () => void;
  showSell?: boolean;
  showCost?: boolean;
}) {
  const { t } = useTranslation();
  const colCount = 6 + (showCost ? 1 : 0) + (showSell ? 1 : 0) + 2;
  return (
    <Card className="p-3 mt-3">
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t('library.search_placeholder', 'Search by name, barcode, category…')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('library.th_item_code', 'Item code')}</TableHead>
            <TableHead>{t('common.name', 'Name')}</TableHead>
            <TableHead>{t('library.th_barcode', 'Barcode')}</TableHead>
            <TableHead>{t('reports.th_category', 'Category')}</TableHead>
            <TableHead>{t('library.th_unit', 'Unit')}</TableHead>
            {showCost && <TableHead className="text-right">{t('reports.th_cost', 'Cost')}</TableHead>}
            {showSell && <TableHead className="text-right">{t('library.th_sale', 'Sale')}</TableHead>}
            <TableHead>{t('sales.th_status', 'Status')}</TableHead>
            <TableHead className="text-right">{t('customers.th_actions', 'Actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={colCount} className="py-4">
                <TableSkeleton rows={5} columns={colCount} />
              </TableCell>
            </TableRow>
          )}
          {!isLoading && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={colCount} className="py-8">
                <EmptyState
                  icon={Library}
                  title={t('library.nothing_here_title', 'Nothing here yet')}
                  description={
                    mode === "review"
                      ? t('library.nothing_here_review_desc', 'No pending contributions to review.')
                      : t('library.nothing_here_import_desc', 'No approved items match your search.')
                  }
                />
              </TableCell>
            </TableRow>
          )}
          {items.map((it) => (
            <TableRow key={it.id}>
              <TableCell className="text-muted-foreground">{it.item_code ?? "—"}</TableCell>
              <TableCell className="font-medium">{it.name}</TableCell>
              <TableCell className="text-muted-foreground">{it.barcode ?? "—"}</TableCell>
              <TableCell>{it.category ?? "—"}</TableCell>
              <TableCell>{it.unit ?? "pcs"}</TableCell>
              {showCost && (
                <TableCell className="text-right tabular-nums">{Number(it.default_cost_price ?? 0).toFixed(2)}</TableCell>
              )}
              {showSell && (
                <TableCell className="text-right tabular-nums">{Number(it.default_sell_price ?? 0).toFixed(2)}</TableCell>
              )}
              <TableCell>
                {it.status === "approved" && <StatusBadge tone="success">{t('library.status_approved', 'Approved')}</StatusBadge>}
                {it.status === "pending" && <StatusBadge tone="warning">{t('library.status_pending', 'Pending')}</StatusBadge>}
                {it.status === "rejected" && <StatusBadge tone="danger">{t('library.status_rejected', 'Rejected')}</StatusBadge>}
              </TableCell>
              <TableCell className="text-right">
                {mode === "import" && <ImportButton item={it} onDone={onDone} showSell={showSell} showCost={showCost} />}
                {mode === "review" && (
                  <div className="inline-flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => onApprove?.(it.id)}>
                      <Check className="h-4 w-4 mr-1" /> {t('library.approve_btn', 'Approve')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onReject?.(it.id)}>
                      <X className="h-4 w-4 mr-1 text-destructive" /> {t('library.reject_btn', 'Reject')}
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

function MineTable({ search, setSearch, showSell = true, showCost = true }: { search: string; setSearch: (v: string) => void; showSell?: boolean; showCost?: boolean }) {
  const { data: uid } = useQuery({
    queryKey: ["auth-uid"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    staleTime: 60_000,
  });
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["global_products", "mine", uid],
    enabled: !!uid,
    queryFn: async () =>
      fetchAll<GlobalProduct>((from: number, to: number) =>
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
      showSell={showSell}
      showCost={showCost}
    />
  );
}

function ImportAllButton({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("bulk_import_from_global_library");
    setBusy(false);
    if (error) return toast.error(error.message);
    const n = (data as number) ?? 0;
    toast.success(
      n > 0
        ? t('library.toast_imported_new', 'Imported {{count}} new item(s). Open Products to set your sale and purchase prices.', { count: n })
        : t('library.toast_nothing_new', 'Nothing new to import — your catalog already has every library item.'),
    );
    setOpen(false);
    onDone();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download className="h-4 w-4 mr-2" /> {t('library.import_all_btn', 'Import all')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('library.confirm_import_all_title', 'Import every library item to your shop?')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t('library.confirm_import_all_desc', 'This pulls every approved library item into your product list in one go. Sale price, cost price and stock start at 0 — open the Products page to fill them in before billing. Items you already have (matched by barcode) are skipped.')}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{t('common.cancel', 'Cancel')}</Button>
          <Button disabled={busy} onClick={run}>{busy ? t('library.importing', 'Importing…') : t('library.import_all_btn', 'Import all')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportButton({ item, onDone, showSell = true, showCost = true }: { item: GlobalProduct; onDone?: () => void; showSell?: boolean; showCost?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [sell, setSell] = useState(showSell ? Number(item.default_sell_price ?? 0) : 0);
  const [cost, setCost] = useState(showCost ? Number(item.default_cost_price ?? 0) : 0);
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
    toast.success(t('library.toast_imported_to_catalog', 'Imported "{{name}}" to your catalog', { name: item.name }));
    setOpen(false);
    onDone?.();
  };
  if (item.status !== "approved") return <span className="text-xs text-muted-foreground">{t('library.awaiting_approval', 'Awaiting approval')}</span>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="h-4 w-4 mr-1" /> {t('library.import_btn', 'Import')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('library.import_item_title', 'Import "{{name}}" to your shop', { name: item.name })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t('library.import_item_desc', 'The name, barcode, category, and unit come from the shared library. Set your own price and stock — these stay private to your shop.')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {showCost && (
            <div>
              <Label>{t('reports.th_cost', 'Cost')}</Label>
              <Input type="number" step="0.01" value={cost} onChange={(e) => setCost(Number(e.target.value))} />
            </div>
          )}
          {showSell && (
            <div>
              <Label>{t('library.field_sell_price', 'Sell price')}</Label>
              <Input type="number" step="0.01" value={sell} onChange={(e) => setSell(Number(e.target.value))} />
            </div>
          )}
          <div>
            <Label>{t('library.field_opening_stock', 'Opening stock')}</Label>
            <Input type="number" step="0.001" value={stock} onChange={(e) => setStock(Number(e.target.value))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button disabled={busy} onClick={doImport}>{busy ? t('library.importing', 'Importing…') : t('library.import_btn', 'Import')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContributeDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return toast.error(t('cash_flow.toast_name_required', 'Name is required'));
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
    toast.success(t('library.toast_submitted', 'Submitted for admin approval'));
    setOpen(false);
    setName(""); setBarcode(""); setCategory(""); setUnit("pcs"); setDescription("");
    onDone();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" />{t('library.contribute_btn', 'Contribute item')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('library.contribute_dialog_title', 'Contribute to global library')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t('library.contribute_desc', 'Only metadata is shared (name, barcode, category, unit). Your prices and stock never leave your shop. An admin must approve before it appears to other shops.')}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>{t('common.name', 'Name')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>{t('library.th_barcode', 'Barcode')}</Label>
            <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </div>
          <div>
            <Label>{t('library.th_unit', 'Unit')}</Label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>{t('reports.th_category', 'Category')}</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>{t('library.notes_optional_label', 'Notes (optional)')}</Label>
            <textarea
              className="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button disabled={busy} onClick={submit}>{busy ? t('library.submitting', 'Submitting…') : t('library.submit_for_approval', 'Submit for approval')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ParsedUpload = {
  cleaned: Array<{
    name: string;
    barcode: string;
    item_code: string | null;
    category: string | null;
    unit: string;
    default_sell_price: number;
    default_cost_price: number;
  }>;
  skipped: number;
  dupInFile: number;
  totalRows: number;
};


function parseAndCleanFile(file: File): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../workers/library-upload.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => worker.terminate();
    worker.onmessage = (e) => {
      cleanup();
      if (e.data?.ok) {
        resolve({
          cleaned: e.data.cleaned,
          skipped: e.data.skipped,
          dupInFile: e.data.dupInFile,
          totalRows: e.data.totalRows,
        });
      } else {
        reject(new Error(e.data?.error ?? "File parse failed"));
      }
    };
    worker.onerror = (e) => { cleanup(); reject(new Error(e.message || "File worker error")); };
    worker.postMessage(file);
  });
}

function BulkUploadDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [progress, setProgress] = useState<{ ok: number; skipped: number; failed: number } | null>(null);

  const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

  const handleFile = async (file: File | null) => {
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    if (![".csv", ".txt", ".xlsx", ".xls"].some((ext) => lowerName.endsWith(ext))) {
      toast.error(t('library.toast_invalid_file_type', 'Please upload a CSV or Excel file (.csv, .xlsx, .xls)'));
      return;
    }
    setBusy(true);
    setProgress(null);
    setStage(t('library.stage_reading', 'Reading file…'));
    try {
      await yieldToUI();
      const { cleaned, skipped, dupInFile, totalRows } = await parseAndCleanFile(file);
      setStage(t('library.stage_processing', 'Processing {{count}} rows…', { count: totalRows }));
      await yieldToUI();
      if (cleaned.length === 0) {
        toast.error(t('library.toast_no_valid_rows', 'No valid rows found. Required: name + barcode. Skipped: {{count}}', { count: skipped }));
        setBusy(false);
        setStage("");
        return;
      }

      setStage(t('library.stage_checking_existing', 'Checking existing barcodes…'));
      await yieldToUI();
      const barcodes = cleaned.map((c) => c.barcode);
      const existing = new Set<string>();
      const lookupChunk = 500;
      for (let i = 0; i < barcodes.length; i += lookupChunk) {
        const slice = barcodes.slice(i, i + lookupChunk);
        const { data } = await supabase
          .from("global_products")
          .select("barcode")
          .in("barcode", slice);
        if (data) for (const row of data) if (row.barcode) existing.add(row.barcode);
        setStage(t('library.stage_checking_progress', 'Checking existing… {{done}}/{{total}}', { done: Math.min(i + lookupChunk, barcodes.length), total: barcodes.length }));
        await yieldToUI();
      }

      let ok = 0;
      let updated = 0;
      let failed = 0;
      const chunk = 200;
      setStage(t('library.stage_uploading_count', 'Uploading {{count}} items…', { count: cleaned.length }));
      await yieldToUI();
      // Upsert on barcode so re-uploads refresh item_code, sale rate and cost rate on existing rows
      for (let i = 0; i < cleaned.length; i += chunk) {
        const slice = cleaned.slice(i, i + chunk).map((r) => ({
          ...r,
          status: "approved" as const,
        }));
        const { error } = await supabase
          .from("global_products")
          .upsert(slice, { onConflict: "barcode" });
        if (error) {
          for (const row of slice) {
            const { error: e2 } = await supabase
              .from("global_products")
              .upsert(row, { onConflict: "barcode" });
            if (e2) failed++;
            else if (existing.has(row.barcode)) updated++;
            else ok++;
          }
        } else {
          for (const row of slice) {
            if (existing.has(row.barcode)) updated++;
            else ok++;
          }
        }
        setProgress({ ok: ok + updated, skipped: skipped + dupInFile, failed });
        setStage(t('library.stage_uploading_progress', 'Uploading… {{done}}/{{total}}', { done: Math.min(i + chunk, cleaned.length), total: cleaned.length }));
        await yieldToUI();
      }
      toast.success(
        t('library.toast_upload_summary', 'Added {{ok}} · Updated {{updated}} · Skipped {{skipped}} ({{missing}} missing, {{dup}} dup in file) · Failed {{failed}}', { ok, updated, skipped: skipped + dupInFile, missing: skipped, dup: dupInFile, failed }),
      );
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? t('library.toast_parse_failed', 'Failed to parse file'));
    } finally {
      setBusy(false);
      setStage("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Upload className="h-4 w-4 mr-2" />{t('library.upload_file_btn', 'Upload file')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('library.bulk_upload_title', 'Bulk upload to global library')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t('library.upload_desc_prefix', 'Upload a CSV or Excel file. Recognized columns (any of these names, case-insensitive):')}
          <br />
          <strong>Item Name</strong>, <strong>Barcode</strong>, <strong>Item Code / SKU</strong>, <strong>Category</strong>, <strong>Unit</strong>, <strong>Sale Rate</strong>, <strong>Purchase Rate</strong>.
          <br />
          {t('library.upload_desc_note_prefix', 'Aik item ke multiple barcodes chahte ho to same name ki multiple rows daal do — har row ka barcode alag. Rows without a name or barcode are skipped. Items ')}<em>pending</em>{t('library.upload_desc_note_suffix', ' me jate hain admin approval ke liye.')}
        </p>

        <div
          className={`rounded-md border border-dashed p-4 transition-colors ${dragActive ? "border-primary bg-muted" : "border-input"}`}
          onDragEnter={(e) => {
            e.preventDefault();
            if (!busy) setDragActive(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (!busy) handleFile(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <Label>{t('library.choose_file_label', 'Choose file (.csv, .xlsx, .xls)')}</Label>
          <Input
            type="file"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              // Reset so selecting the same file again re-triggers onChange.
              e.target.value = "";
              handleFile(f);
            }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t('library.drag_drop_hint', 'If Windows file picker hangs, drag and drop the file here instead. File type is checked after selection.')}
          </p>
        </div>
        {busy && stage && (
          <div className="text-sm text-muted-foreground">{stage}</div>
        )}
        {progress && (
          <div className="text-sm text-muted-foreground">
            {t('library.uploaded_summary', 'Uploaded: {{ok}} · Skipped: {{skipped}} · Failed: {{failed}}', { ok: progress.ok, skipped: progress.skipped, failed: progress.failed })}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            {busy ? t('library.uploading', 'Uploading…') : t('common.close', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
