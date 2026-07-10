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
  const { isAdmin } = usePermissions();
  const [tab, setTab] = useState<"browse" | "queue" | "mine">("browse");
  const [search, setSearch] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["global_products", tab],
    queryFn: async () => {
      const rows = await fetchAll<GlobalProduct>((from, to) => {
        let q = supabase.from("global_products").select("*").order("created_at", { ascending: false });
        if (tab === "browse") q = q.eq("status", "approved");
        else if (tab === "queue") q = q.eq("status", "pending");
        else if (tab === "mine") {
          // handled below
        }
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
        description="Shared catalog metadata contributed by all shops. Prices and stock stay private to your shop."
        icon={<Library className="h-5 w-5" />}
        actions={<ContributeDialog onDone={invalidate} />}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="browse">
            <ShieldCheck className="h-4 w-4 mr-1" /> Approved
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="queue">
              <Clock className="h-4 w-4 mr-1" /> Review queue
            </TabsTrigger>
          )}
          <TabsTrigger value="mine">My contributions</TabsTrigger>
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

        {isAdmin && (
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

        <TabsContent value="mine">
          <MineTable search={search} setSearch={setSearch} />
        </TabsContent>
      </Tabs>
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
