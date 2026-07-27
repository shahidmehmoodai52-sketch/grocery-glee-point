import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, differenceInDays } from "date-fns";
import { toast } from "sonner";
import {
  CalendarClock,
  AlertTriangle,
  Skull,
  Package,
  Plus,
  Trash2,
  FileDown,
  TrendingDown,
  TrendingUp,
  Scale,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { usePermissions } from "@/hooks/use-permissions";
import { fmtMoney, fmtQty } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";

export const Route = createFileRoute("/_authenticated/expiry")({
  component: ExpiryPage,
});

type Batch = {
  id: string;
  product_id: string;
  product_name: string;
  sku: string | null;
  unit: string | null;
  batch_no: string | null;
  purchase_date: string | null;
  expiry_date: string | null;
  qty_remaining: number;
  qty_initial: number;
  unit_cost: number | null;
  value_remaining: number;
  supplier_id: string | null;
  status: string;
  days_remaining: number | null;
  expiry_status: "fresh" | "expiring_soon" | "critical" | "expired" | "no_expiry";
};

const STATUS_META: Record<string, { label: string; classes: string; icon: any }> = {
  fresh: { label: "Fresh", classes: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", icon: Package },
  expiring_soon: { label: "Expiring soon", classes: "bg-amber-500/15 text-amber-600 border-amber-500/30", icon: CalendarClock },
  critical: { label: "Critical", classes: "bg-orange-500/15 text-orange-600 border-orange-500/30", icon: AlertTriangle },
  expired: { label: "Expired", classes: "bg-red-500/15 text-red-600 border-red-500/30", icon: Skull },
  no_expiry: { label: "No expiry", classes: "bg-muted text-muted-foreground border-border", icon: Package },
};

const DAMAGE_TYPES = ["broken", "leaking", "customer_return", "transport", "warehouse", "other"] as const;
const WASTE_TYPES = ["expired", "damaged", "disposal", "donation", "internal_use"] as const;

function ExpiryPage() {
  const { data: settings } = useSettings();
  const { isAdmin, can } = usePermissions();
  const sym = settings?.currency_symbol ?? "Rs";
  const canWrite = isAdmin || can("products");

  const batchesQ = useQuery({
    queryKey: ["batches-status"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_batch_status" as any)
        .select("*")
        .order("expiry_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as Batch[];
    },
  });

  const batches = batchesQ.data ?? [];

  const stats = useMemo(() => {
    const now = new Date();
    const expiredToday = batches.filter(
      (b) => b.expiry_date && differenceInDays(new Date(b.expiry_date), now) === 0
    );
    const in7 = batches.filter((b) => b.days_remaining != null && b.days_remaining > 0 && b.days_remaining <= 7);
    const in30 = batches.filter((b) => b.days_remaining != null && b.days_remaining > 0 && b.days_remaining <= 30);
    const expired = batches.filter((b) => b.expiry_status === "expired");
    const expiredValue = expired.reduce((s, b) => s + Number(b.value_remaining || 0), 0);
    const atRisk = batches.filter(
      (b) => b.expiry_status === "expiring_soon" || b.expiry_status === "critical" || b.expiry_status === "expired"
    );
    return { expiredToday: expiredToday.length, in7: in7.length, in30: in30.length, expired: expired.length, expiredValue, atRisk: atRisk.length };
  }, [batches]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Expiry, Damage & Waste"
        description="Product lifecycle: batches, near-expiry, damage & waste tracking."
        icon={<CalendarClock className="h-5 w-5" />}
      />


      {/* Dashboard cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Expired today" value={String(stats.expiredToday)} tone="red" icon={Skull} />
        <StatCard label="Expiring in 7 days" value={String(stats.in7)} tone="orange" icon={AlertTriangle} />
        <StatCard label="Expiring in 30 days" value={String(stats.in30)} tone="amber" icon={CalendarClock} />
        <StatCard label="Expired (all)" value={String(stats.expired)} tone="red" icon={Skull} />
        <StatCard label="Expired value" value={fmtMoney(stats.expiredValue, sym)} tone="red" icon={TrendingDown} />
        <StatCard label="Products at risk" value={String(stats.atRisk)} tone="amber" icon={AlertTriangle} />
      </div>

      <Tabs defaultValue="batches" className="mt-4">
        <TabsList>
          <TabsTrigger value="batches">Batches</TabsTrigger>
          <TabsTrigger value="damage">Damage log</TabsTrigger>
          <TabsTrigger value="waste">Waste log</TabsTrigger>
          <TabsTrigger value="shortexcess">Short & Excess</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="batches" className="mt-4">
          <BatchesTab batches={batches} loading={batchesQ.isLoading} sym={sym} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="damage" className="mt-4">
          <DamageTab sym={sym} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="waste" className="mt-4">
          <WasteTab sym={sym} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="shortexcess" className="mt-4">
          <ShortExcessTab sym={sym} />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsTab sym={sym} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone: "red" | "orange" | "amber" | "green";
  icon: any;
}) {
  const toneClass = {
    red: "text-red-600",
    orange: "text-orange-600",
    amber: "text-amber-600",
    green: "text-emerald-600",
  }[tone];
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${toneClass}`} />
        <span>{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold truncate">{value}</div>
    </Card>
  );
}

// ----------------- BATCHES TAB -----------------
function BatchesTab({ batches, loading, sym, canWrite }: { batches: Batch[]; loading: boolean; sym: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [actionBatch, setActionBatch] = useState<Batch | null>(null);
  const [actionType, setActionType] = useState<"waste" | "damage" | null>(null);

  const filtered = useMemo(() => {
    return batches.filter((b) => {
      if (filter !== "all" && b.expiry_status !== filter) return false;
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        return (
          b.product_name?.toLowerCase().includes(s) ||
          b.sku?.toLowerCase().includes(s) ||
          b.batch_no?.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [batches, filter, search]);

  const exportCsv = () => {
    const rows = [
      ["Product", "SKU", "Batch", "Purchase", "Expiry", "Days", "Qty", "Value", "Status"],
      ...filtered.map((b) => [
        b.product_name,
        b.sku ?? "",
        b.batch_no ?? "",
        b.purchase_date ?? "",
        b.expiry_date ?? "",
        b.days_remaining ?? "",
        b.qty_remaining,
        b.value_remaining,
        b.expiry_status,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `batches-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="overflow-hidden">
      <div className="p-3 border-b flex flex-wrap gap-2 items-center">
        <Input placeholder="Search product / SKU / batch…" className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="fresh">Fresh</SelectItem>
            <SelectItem value="expiring_soon">Expiring soon</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="no_expiry">No expiry</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <FileDown className="h-4 w-4 mr-1" /> Export
          </Button>
          {canWrite && (
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add batch</Button>
              </DialogTrigger>
              <AddBatchDialog onClose={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ["batches-status"] }); }} />
            </Dialog>
          )}
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Purchased</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="text-right">Days</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead>Status</TableHead>
            {canWrite && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground p-6">Loading…</TableCell></TableRow>}
          {!loading && filtered.length === 0 && (
            <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground p-6">No batches match.</TableCell></TableRow>
          )}
          {filtered.map((b) => {
            const meta = STATUS_META[b.expiry_status];
            const Icon = meta.icon;
            return (
              <TableRow key={b.id}>
                <TableCell>
                  <div className="font-medium">{b.product_name}</div>
                  <div className="text-xs text-muted-foreground">{b.sku ?? "—"}</div>
                </TableCell>
                <TableCell className="font-mono text-xs">{b.batch_no ?? "—"}</TableCell>
                <TableCell className="text-xs">{b.purchase_date ? format(new Date(b.purchase_date), "PP") : "—"}</TableCell>
                <TableCell className="text-xs">{b.expiry_date ? format(new Date(b.expiry_date), "PP") : "—"}</TableCell>
                <TableCell className="text-right">
                  {b.days_remaining == null ? "—" : b.days_remaining < 0 ? `${b.days_remaining}` : `${b.days_remaining}d`}
                </TableCell>
                <TableCell className="text-right">{fmtQty(b.qty_remaining)} {b.unit ?? ""}</TableCell>
                <TableCell className="text-right">{fmtMoney(b.value_remaining, sym)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={meta.classes}>
                    <Icon className="h-3 w-3 mr-1" /> {meta.label}
                  </Badge>
                </TableCell>
                {canWrite && (
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setActionBatch(b); setActionType("waste"); }}
                    >
                      Dispose
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={!!actionBatch} onOpenChange={(o) => !o && setActionBatch(null)}>
        {actionBatch && (
          <BatchActionDialog
            batch={actionBatch}
            defaultType={actionType === "damage" ? "damaged" : "expired"}
            onClose={() => { setActionBatch(null); qc.invalidateQueries({ queryKey: ["batches-status"] }); qc.invalidateQueries({ queryKey: ["waste-log"] }); }}
          />
        )}
      </Dialog>
    </Card>
  );
}

function AddBatchDialog({ onClose }: { onClose: () => void }) {
  const [productId, setProductId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [qty, setQty] = useState("");
  const [expiry, setExpiry] = useState("");
  const [mfg, setMfg] = useState("");
  const [cost, setCost] = useState("");
  const [saving, setSaving] = useState(false);

  const productsQ = useQuery({
    queryKey: ["products-picker", search],
    queryFn: async () => {
      let q = supabase.from("products").select("id,name,sku,cost_price,track_batches").eq("is_active", true).limit(20);
      if (search.trim()) q = q.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = async () => {
    if (!productId) return toast.error("Pick a product");
    const q = Number(qty);
    if (!q || q <= 0) return toast.error("Quantity must be positive");
    setSaving(true);
    const { error } = await supabase.rpc("create_product_batch" as any, {
      _product_id: productId,
      _batch_no: batchNo.trim() || null,
      _qty: q,
      _expiry_date: expiry || null,
      _mfg_date: mfg || null,
      _unit_cost: cost ? Number(cost) : null,
      _supplier_id: null,
      _note: null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Batch added");
    onClose();
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>Add batch</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Product</Label>
          <Input placeholder="Search product…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mt-2 max-h-40 overflow-y-auto border rounded">
            {(productsQ.data ?? []).map((p: any) => (
              <button
                key={p.id}
                onClick={() => { setProductId(p.id); setSearch(p.name); if (!cost && p.cost_price) setCost(String(p.cost_price)); }}
                className={`w-full text-left px-2 py-1.5 text-sm hover:bg-accent ${productId === p.id ? "bg-accent" : ""}`}
              >
                {p.name} <span className="text-muted-foreground">{p.sku ?? ""}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Batch #</Label><Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} /></div>
          <div><Label className="text-xs">Qty</Label><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div><Label className="text-xs">Mfg date</Label><Input type="date" value={mfg} onChange={(e) => setMfg(e.target.value)} /></div>
          <div><Label className="text-xs">Expiry date</Label><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
          <div className="col-span-2"><Label className="text-xs">Unit cost</Label><Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
        </div>
        <p className="text-xs text-muted-foreground">Adding a batch here does not change on-hand stock — it tags existing stock. Use Purchases to receive new stock.</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>Save batch</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function BatchActionDialog({ batch, defaultType, onClose }: { batch: Batch; defaultType: string; onClose: () => void }) {
  const [mode, setMode] = useState<"waste" | "damage">(defaultType === "damaged" ? "damage" : "waste");
  const [type, setType] = useState<string>(defaultType);
  const [qty, setQty] = useState<string>(String(batch.qty_remaining));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const q = Number(qty);
    if (!q || q <= 0) return toast.error("Quantity must be positive");
    if (q > Number(batch.qty_remaining)) return toast.error(`Only ${batch.qty_remaining} left in batch`);
    setSaving(true);
    const rpc = mode === "damage" ? "record_damage" : "record_waste";
    const { error } = await supabase.rpc(rpc as any, {
      _product_id: batch.product_id,
      _qty: q,
      [mode === "damage" ? "_damage_type" : "_waste_type"]: type,
      _batch_id: batch.id,
      _reason: reason || null,
      _note: null,
    } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(mode === "damage" ? "Damage recorded" : "Waste recorded");
    onClose();
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Dispose batch · {batch.product_name}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Batch {batch.batch_no ?? "—"} · {fmtQty(batch.qty_remaining)} left · expires {batch.expiry_date ?? "—"}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={mode} onValueChange={(v) => { setMode(v as any); setType(v === "damage" ? "broken" : "expired"); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="waste">Waste / expired</SelectItem>
                <SelectItem value="damage">Damage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(mode === "damage" ? DAMAGE_TYPES : WASTE_TYPES).map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Qty</Label><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        </div>
        <div><Label className="text-xs">Reason</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} variant="destructive">
          <Trash2 className="h-4 w-4 mr-1" /> Record
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ----------------- DAMAGE TAB -----------------
function DamageTab({ sym, canWrite }: { sym: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["damage-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_damages" as any)
        .select("*, products(name, sku, unit)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <Card>
      <div className="p-3 border-b flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{q.data?.length ?? 0} damage entries</div>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Record damage</Button></DialogTrigger>
            <RecordDialog mode="damage" onClose={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["damage-log"] }); qc.invalidateQueries({ queryKey: ["batches-status"] }); }} />
          </Dialog>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(q.data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="p-6 text-center text-muted-foreground">No damage recorded.</TableCell></TableRow>}
          {(q.data ?? []).map((r: any) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs">{format(new Date(r.created_at), "PP p")}</TableCell>
              <TableCell><div className="font-medium">{r.products?.name ?? "—"}</div><div className="text-xs text-muted-foreground">{r.products?.sku ?? ""}</div></TableCell>
              <TableCell><Badge variant="outline">{String(r.damage_type).replace(/_/g, " ")}</Badge></TableCell>
              <TableCell className="text-right">{fmtQty(r.qty)} {r.products?.unit ?? ""}</TableCell>
              <TableCell className="text-right">{fmtMoney(r.total_value ?? 0, sym)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.reason ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// ----------------- WASTE TAB -----------------
function WasteTab({ sym, canWrite }: { sym: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["waste-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_waste" as any)
        .select("*, products(name, sku, unit)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <Card>
      <div className="p-3 border-b flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{q.data?.length ?? 0} waste entries</div>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Record waste</Button></DialogTrigger>
            <RecordDialog mode="waste" onClose={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["waste-log"] }); qc.invalidateQueries({ queryKey: ["batches-status"] }); }} />
          </Dialog>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(q.data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="p-6 text-center text-muted-foreground">No waste recorded.</TableCell></TableRow>}
          {(q.data ?? []).map((r: any) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs">{format(new Date(r.created_at), "PP p")}</TableCell>
              <TableCell><div className="font-medium">{r.products?.name ?? "—"}</div><div className="text-xs text-muted-foreground">{r.products?.sku ?? ""}</div></TableCell>
              <TableCell><Badge variant="outline">{String(r.waste_type).replace(/_/g, " ")}</Badge></TableCell>
              <TableCell className="text-right">{fmtQty(r.qty)} {r.products?.unit ?? ""}</TableCell>
              <TableCell className="text-right">{fmtMoney(r.total_value ?? 0, sym)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.reason ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function RecordDialog({ mode, onClose }: { mode: "damage" | "waste"; onClose: () => void }) {
  const [productId, setProductId] = useState("");
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState("");
  const [type, setType] = useState<string>(mode === "damage" ? "broken" : "expired");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const productsQ = useQuery({
    queryKey: ["products-picker", search],
    queryFn: async () => {
      let qb = supabase.from("products").select("id,name,sku,stock,unit").eq("is_active", true).limit(20);
      if (search.trim()) qb = qb.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
      const { data, error } = await qb;
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = async () => {
    if (!productId) return toast.error("Pick a product");
    const n = Number(qty);
    if (!n || n <= 0) return toast.error("Quantity must be positive");
    setSaving(true);
    const rpc = mode === "damage" ? "record_damage" : "record_waste";
    const { error } = await supabase.rpc(rpc as any, {
      _product_id: productId,
      _qty: n,
      [mode === "damage" ? "_damage_type" : "_waste_type"]: type,
      _batch_id: null,
      _reason: reason || null,
      _note: null,
    } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(mode === "damage" ? "Damage recorded" : "Waste recorded");
    onClose();
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>Record {mode}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Product</Label>
          <Input placeholder="Search product…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mt-2 max-h-40 overflow-y-auto border rounded">
            {(productsQ.data ?? []).map((p: any) => (
              <button key={p.id} onClick={() => { setProductId(p.id); setSearch(p.name); }} className={`w-full text-left px-2 py-1.5 text-sm hover:bg-accent ${productId === p.id ? "bg-accent" : ""}`}>
                {p.name} <span className="text-muted-foreground">· stock {fmtQty(p.stock ?? 0)} {p.unit ?? ""}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(mode === "damage" ? DAMAGE_TYPES : WASTE_TYPES).map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Qty</Label><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        </div>
        <div><Label className="text-xs">Reason / note</Label><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving} variant="destructive">Record</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ----------------- REPORTS TAB -----------------
function ReportsTab({ sym }: { sym: string }) {
  const [days, setDays] = useState("30");

  const q = useQuery({
    queryKey: ["expiry-reports", days],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - Number(days));
      const [d, w] = await Promise.all([
        supabase.from("inventory_damages" as any).select("damage_type, qty, total_value").gte("created_at", since.toISOString()),
        supabase.from("inventory_waste" as any).select("waste_type, qty, total_value").gte("created_at", since.toISOString()),
      ]);
      return { damages: (d.data ?? []) as any[], waste: (w.data ?? []) as any[] };
    },
  });

  const byType = (rows: any[], key: string) => {
    const map = new Map<string, { qty: number; value: number }>();
    for (const r of rows) {
      const k = String(r[key] ?? "other");
      const cur = map.get(k) ?? { qty: 0, value: 0 };
      cur.qty += Number(r.qty || 0);
      cur.value += Number(r.total_value || 0);
      map.set(k, cur);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].value - a[1].value);
  };

  const damageTotals = byType(q.data?.damages ?? [], "damage_type");
  const wasteTotals = byType(q.data?.waste ?? [], "waste_type");
  const damageLoss = damageTotals.reduce((s, [, v]) => s + v.value, 0);
  const wasteLoss = wasteTotals.reduce((s, [, v]) => s + v.value, 0);

  return (
    <div className="space-y-4">
      <Card className="p-3 flex items-center gap-3">
        <Label className="text-xs">Window</Label>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last 12 months</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-6 text-sm">
          <div><span className="text-muted-foreground">Damage loss:</span> <span className="font-semibold text-red-600">{fmtMoney(damageLoss, sym)}</span></div>
          <div><span className="text-muted-foreground">Waste loss:</span> <span className="font-semibold text-red-600">{fmtMoney(wasteLoss, sym)}</span></div>
          <div><span className="text-muted-foreground">Total:</span> <span className="font-semibold">{fmtMoney(damageLoss + wasteLoss, sym)}</span></div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <div className="p-3 border-b font-medium">Damage by type</div>
          <Table>
            <TableHeader><TableRow><TableHead>Type</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
            <TableBody>
              {damageTotals.length === 0 && <TableRow><TableCell colSpan={3} className="p-4 text-center text-muted-foreground">No data</TableCell></TableRow>}
              {damageTotals.map(([k, v]) => (
                <TableRow key={k}><TableCell className="capitalize">{k.replace(/_/g, " ")}</TableCell><TableCell className="text-right">{fmtQty(v.qty)}</TableCell><TableCell className="text-right">{fmtMoney(v.value, sym)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card>
          <div className="p-3 border-b font-medium">Waste by type</div>
          <Table>
            <TableHeader><TableRow><TableHead>Type</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
            <TableBody>
              {wasteTotals.length === 0 && <TableRow><TableCell colSpan={3} className="p-4 text-center text-muted-foreground">No data</TableCell></TableRow>}
              {wasteTotals.map(([k, v]) => (
                <TableRow key={k}><TableCell className="capitalize">{k.replace(/_/g, " ")}</TableCell><TableCell className="text-right">{fmtQty(v.qty)}</TableCell><TableCell className="text-right">{fmtMoney(v.value, sym)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

// ----------------- SHORT & EXCESS TAB -----------------
type SEItem = {
  product_id: string;
  product_name: string;
  sku: string | null;
  unit: string | null;
  cost_price: number;
  system_qty: number;
  actual_qty: number;
  diff: number;
  variance_value: number;
  session_id: string;
  session_ref: string | null;
  counted_at: string;
};

function ShortExcessTab({ sym }: { sym: string }) {
  const [days, setDays] = useState("30");
  const [filter, setFilter] = useState<"all" | "short" | "excess">("all");
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["short-excess", days],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - Number(days));

      // Pull completed sessions in window
      const { data: sessions, error: sErr } = await supabase
        .from("stock_count_sessions" as any)
        .select("id, ref, status, completed_at, created_at")
        .eq("status", "completed")
        .gte("completed_at", since.toISOString())
        .order("completed_at", { ascending: false });
      if (sErr) throw sErr;
      const sIds = (sessions ?? []).map((s: any) => s.id);
      if (sIds.length === 0) return [] as SEItem[];

      const { data: items, error: iErr } = await supabase
        .from("stock_count_items" as any)
        .select("session_id, product_id, system_qty, actual_qty, counted_at")
        .in("session_id", sIds);
      if (iErr) throw iErr;

      const pIds = Array.from(new Set((items ?? []).map((i: any) => i.product_id)));
      const { data: products, error: pErr } = await supabase
        .from("products")
        .select("id, name, sku, unit, cost_price")
        .in("id", pIds);
      if (pErr) throw pErr;

      const pMap = new Map((products ?? []).map((p: any) => [p.id, p]));
      const sMap = new Map((sessions ?? []).map((s: any) => [s.id, s]));

      const rows: SEItem[] = (items ?? [])
        .map((it: any) => {
          const p: any = pMap.get(it.product_id);
          const s: any = sMap.get(it.session_id);
          const diff = Number(it.actual_qty ?? 0) - Number(it.system_qty ?? 0);
          const cost = Number(p?.cost_price ?? 0);
          return {
            product_id: it.product_id,
            product_name: p?.name ?? "Unknown",
            sku: p?.sku ?? null,
            unit: p?.unit ?? null,
            cost_price: cost,
            system_qty: Number(it.system_qty ?? 0),
            actual_qty: Number(it.actual_qty ?? 0),
            diff,
            variance_value: diff * cost,
            session_id: it.session_id,
            session_ref: s?.ref ?? null,
            counted_at: it.counted_at,
          };
        })
        .filter((r: SEItem) => r.diff !== 0);

      rows.sort((a, b) => Math.abs(b.variance_value) - Math.abs(a.variance_value));
      return rows;
    },
  });

  const rows = q.data ?? [];
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter === "short" && r.diff >= 0) return false;
      if (filter === "excess" && r.diff <= 0) return false;
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        return r.product_name.toLowerCase().includes(s) || (r.sku ?? "").toLowerCase().includes(s);
      }
      return true;
    });
  }, [rows, filter, search]);

  const totals = useMemo(() => {
    let shortQty = 0, shortVal = 0, exQty = 0, exVal = 0;
    for (const r of rows) {
      if (r.diff < 0) { shortQty += -r.diff; shortVal += -r.variance_value; }
      else { exQty += r.diff; exVal += r.variance_value; }
    }
    return { shortQty, shortVal, exQty, exVal, net: exVal - shortVal, count: rows.length };
  }, [rows]);

  const exportCsv = () => {
    const header = ["Product", "SKU", "System", "Actual", "Diff", "Cost", "Variance value", "Session", "Counted at"];
    const csvRows = [header, ...filtered.map((r) => [
      r.product_name, r.sku ?? "", r.system_qty, r.actual_qty, r.diff, r.cost_price, r.variance_value,
      r.session_ref ?? r.session_id, r.counted_at,
    ])];
    const csv = csvRows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `short-excess-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Short qty (missing)" value={fmtQty(totals.shortQty)} tone="red" icon={TrendingDown} />
        <StatCard label="Short value" value={fmtMoney(totals.shortVal, sym)} tone="red" icon={TrendingDown} />
        <StatCard label="Excess qty (over)" value={fmtQty(totals.exQty)} tone="green" icon={TrendingUp} />
        <StatCard label="Net variance" value={fmtMoney(totals.net, sym)} tone={totals.net < 0 ? "red" : "green"} icon={Scale} />
      </div>

      <Card className="overflow-hidden">
        <div className="p-3 border-b flex flex-wrap items-center gap-2">
          <Input placeholder="Search product / SKU…" className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All variances</SelectItem>
              <SelectItem value="short">Short only</SelectItem>
              <SelectItem value="excess">Excess only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <FileDown className="h-4 w-4 mr-1" /> Export
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/stock-count">Open stock count</Link>
            </Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">System</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Diff</TableHead>
              <TableHead className="text-right">Variance value</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Session</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading && <TableRow><TableCell colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!q.isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="p-6 text-center text-muted-foreground">
                No variances in this window. Complete a stock count to see shortages and excesses here.
              </TableCell></TableRow>
            )}
            {filtered.map((r, i) => (
              <TableRow key={`${r.session_id}-${r.product_id}-${i}`}>
                <TableCell>
                  <div className="font-medium">{r.product_name}</div>
                  <div className="text-xs text-muted-foreground">{r.sku ?? "—"}</div>
                </TableCell>
                <TableCell className="text-right">{fmtQty(r.system_qty)} {r.unit ?? ""}</TableCell>
                <TableCell className="text-right">{fmtQty(r.actual_qty)} {r.unit ?? ""}</TableCell>
                <TableCell className={`text-right font-medium ${r.diff < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {r.diff > 0 ? "+" : ""}{fmtQty(r.diff)}
                </TableCell>
                <TableCell className={`text-right ${r.variance_value < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {fmtMoney(r.variance_value, sym)}
                </TableCell>
                <TableCell>
                  {r.diff < 0 ? (
                    <Badge variant="outline" className="bg-red-500/15 text-red-600 border-red-500/30">
                      <TrendingDown className="h-3 w-3 mr-1" /> Short
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                      <TrendingUp className="h-3 w-3 mr-1" /> Excess
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  <Link to="/stock-count/$id" params={{ id: r.session_id }} className="underline text-primary">
                    {r.session_ref ?? r.session_id.slice(0, 8)}
                  </Link>
                  <div className="text-muted-foreground">{format(new Date(r.counted_at), "PP")}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
