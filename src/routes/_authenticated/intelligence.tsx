import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Skull,
  Package,
  ShoppingCart,
  FileDown,
  Zap,
  Activity,
  Snowflake,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { usePermissions } from "@/hooks/use-permissions";
import { fmtMoney, fmtQty } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { NeedsInternetBanner } from "@/components/needs-internet-banner";
import { fetchAll } from "@/lib/supabase-page";

export const Route = createFileRoute("/_authenticated/intelligence")({
  component: IntelligencePage,
});

type Intel = {
  product_id: string;
  tenant_id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  category: string | null;
  stock: number;
  cost_price: number | null;
  sell_price: number | null;
  min_stock: number | null;
  max_stock: number | null;
  safety_stock: number;
  lead_time_days: number;
  preferred_supplier_id: string | null;
  reorder_qty: number | null;
  sales_qty_90d: number;
  sales_qty_30d: number;
  sales_qty_7d: number;
  avg_daily: number;
  avg_weekly: number;
  avg_monthly: number;
  revenue_90d: number;
  profit_90d: number;
  cogs_90d: number;
  last_sale_at: string | null;
  next_expiry: string | null;
  qty_expiring_30d: number;
  days_remaining: number | null;
  inventory_turnover: number | null;
  sell_through_30d: number | null;
  velocity_class: "fast" | "normal" | "slow" | "dead" | "sleeping";
  abc_class: "A" | "B" | "C";
  suggested_qty: number;
  is_out_of_stock: boolean;
  is_low_stock: boolean;
  is_overstock: boolean;
  is_dead_stock: boolean;
  is_near_expiry: boolean;
  is_sales_spike: boolean;
  is_sales_drop: boolean;
  health_score: number;
};

const VELOCITY_META: Record<string, { label: string; classes: string; icon: any }> = {
  fast: { label: "Fast", classes: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", icon: Zap },
  normal: { label: "Normal", classes: "bg-blue-500/15 text-blue-600 border-blue-500/30", icon: Activity },
  slow: { label: "Slow", classes: "bg-amber-500/15 text-amber-600 border-amber-500/30", icon: TrendingDown },
  sleeping: { label: "Sleeping", classes: "bg-slate-500/15 text-slate-600 border-slate-500/30", icon: Snowflake },
  dead: { label: "Dead", classes: "bg-red-500/15 text-red-600 border-red-500/30", icon: Skull },
};

const ABC_META: Record<string, string> = {
  A: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  B: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  C: "bg-slate-500/15 text-slate-600 border-slate-500/30",
};

function IntelligencePage() {
  const { data: settings } = useSettings();
  const { isAdmin, can } = usePermissions();
  const sym = settings?.currency_symbol ?? "Rs";
  const canWrite = isAdmin || can("products");

  const intelQ = useQuery({
    queryKey: ["product-intel"],
    queryFn: async () => {
      const { data, error } = { data: await fetchAll<any>((_f, _t) => supabase
        .from("product_intelligence" as any)
        .select("*")
        .order("revenue_90d", { ascending: false })
        .range(_f, _t) as any), error: null as any };
      if (error) throw error;
      return (data ?? []) as unknown as Intel[];
    },
  });

  const rows = intelQ.data ?? [];

  const stats = useMemo(() => {
    if (!rows.length) return null;
    const totalValue = rows.reduce((s, r) => s + (r.stock * (r.cost_price || 0)), 0);
    const deadValue = rows.filter((r) => r.is_dead_stock).reduce((s, r) => s + r.stock * (r.cost_price || 0), 0);
    const overstockValue = rows.filter((r) => r.is_overstock).reduce((s, r) => s + r.stock * (r.cost_price || 0), 0);
    const avgHealth = rows.reduce((s, r) => s + (r.health_score || 0), 0) / rows.length;
    const abcCount = { A: 0, B: 0, C: 0 };
    for (const r of rows) abcCount[r.abc_class] = (abcCount[r.abc_class] || 0) + 1;
    const velCount: Record<string, number> = {};
    for (const r of rows) velCount[r.velocity_class] = (velCount[r.velocity_class] || 0) + 1;
    const alerts = {
      out: rows.filter((r) => r.is_out_of_stock).length,
      low: rows.filter((r) => r.is_low_stock).length,
      overstock: rows.filter((r) => r.is_overstock).length,
      dead: rows.filter((r) => r.is_dead_stock).length,
      near_expiry: rows.filter((r) => r.is_near_expiry).length,
      spike: rows.filter((r) => r.is_sales_spike).length,
      drop: rows.filter((r) => r.is_sales_drop).length,
    };
    const suggested = rows.filter((r) => r.suggested_qty > 0);
    const suggestedCost = suggested.reduce((s, r) => s + r.suggested_qty * (r.cost_price || 0), 0);
    return { totalValue, deadValue, overstockValue, avgHealth, abcCount, velCount, alerts, suggestedCount: suggested.length, suggestedCost };
  }, [rows]);

  return (
    <div className="p-6 space-y-4">
      <NeedsInternetBanner section="Intelligence" />
      <PageHeader
        title="Inventory Intelligence"
        description="ABC classification, velocity, reorder suggestions & smart alerts. Updates automatically from sales."
        icon={<Brain className="h-5 w-5" />}
      />


      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <StatCard label="Inventory health" value={`${Math.round(stats.avgHealth)}%`} tone={stats.avgHealth > 70 ? "green" : stats.avgHealth > 40 ? "amber" : "red"} />
          <StatCard label="Inventory value" value={fmtMoney(stats.totalValue, sym)} tone="blue" />
          <StatCard label="Dead stock value" value={fmtMoney(stats.deadValue, sym)} tone="red" />
          <StatCard label="Overstock value" value={fmtMoney(stats.overstockValue, sym)} tone="amber" />
          <StatCard label="A products" value={String(stats.abcCount.A)} tone="green" />
          <StatCard label="B products" value={String(stats.abcCount.B)} tone="amber" />
          <StatCard label="Fast movers" value={String(stats.velCount.fast || 0)} tone="green" />
          <StatCard label="Suggested PO" value={`${stats.suggestedCount} · ${fmtMoney(stats.suggestedCost, sym)}`} tone="blue" />
        </div>
      )}

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">Smart alerts</TabsTrigger>
          <TabsTrigger value="reorder">Reorder</TabsTrigger>
          <TabsTrigger value="abc">ABC</TabsTrigger>
          <TabsTrigger value="velocity">Velocity</TabsTrigger>
          <TabsTrigger value="suggestions">Purchase suggestions</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="mt-4">
          <AlertsTab rows={rows} sym={sym} stats={stats} />
        </TabsContent>
        <TabsContent value="reorder" className="mt-4">
          <ReorderTab rows={rows} sym={sym} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="abc" className="mt-4">
          <AbcTab rows={rows} sym={sym} />
        </TabsContent>
        <TabsContent value="velocity" className="mt-4">
          <VelocityTab rows={rows} sym={sym} />
        </TabsContent>
        <TabsContent value="suggestions" className="mt-4">
          <SuggestionsTab sym={sym} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: "green" | "red" | "amber" | "blue" }) {
  const toneClass = {
    green: "text-emerald-600",
    red: "text-red-600",
    amber: "text-amber-600",
    blue: "text-blue-600",
  }[tone];
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold truncate ${toneClass}`}>{value}</div>
    </Card>
  );
}

// ------------- ALERTS -------------
function AlertsTab({ rows, sym, stats }: { rows: Intel[]; sym: string; stats: any }) {
  const [type, setType] = useState<string>("all");
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (type === "out") return r.is_out_of_stock;
      if (type === "low") return r.is_low_stock;
      if (type === "overstock") return r.is_overstock;
      if (type === "dead") return r.is_dead_stock;
      if (type === "near_expiry") return r.is_near_expiry;
      if (type === "spike") return r.is_sales_spike;
      if (type === "drop") return r.is_sales_drop;
      return r.is_out_of_stock || r.is_low_stock || r.is_overstock || r.is_dead_stock || r.is_near_expiry || r.is_sales_spike || r.is_sales_drop;
    });
  }, [rows, type]);

  return (
    <Card>
      <div className="p-3 border-b flex gap-2 flex-wrap">
        {[
          { k: "all", l: `All (${stats ? Object.values(stats.alerts).reduce((a: any, b: any) => a + b, 0) : 0})` },
          { k: "out", l: `Out ${stats?.alerts.out ?? 0}` },
          { k: "low", l: `Low ${stats?.alerts.low ?? 0}` },
          { k: "overstock", l: `Overstock ${stats?.alerts.overstock ?? 0}` },
          { k: "dead", l: `Dead ${stats?.alerts.dead ?? 0}` },
          { k: "near_expiry", l: `Near expiry ${stats?.alerts.near_expiry ?? 0}` },
          { k: "spike", l: `Spike ${stats?.alerts.spike ?? 0}` },
          { k: "drop", l: `Drop ${stats?.alerts.drop ?? 0}` },
        ].map((t) => (
          <Button key={t.k} variant={type === t.k ? "default" : "outline"} size="sm" onClick={() => setType(t.k)}>{t.l}</Button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Alerts</TableHead>
            <TableHead className="text-right">Stock</TableHead>
            <TableHead className="text-right">Days left</TableHead>
            <TableHead className="text-right">30d sales</TableHead>
            <TableHead className="text-right">Suggested qty</TableHead>
            <TableHead className="text-right">Health</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="p-6 text-center text-muted-foreground">No alerts. Inventory is healthy.</TableCell></TableRow>}
          {filtered.slice(0, 500).map((r) => (
            <TableRow key={r.product_id}>
              <TableCell>
                <Link to="/products/$id" params={{ id: r.product_id }} className="font-medium hover:underline">
                  {r.name}
                </Link>
                <div className="text-xs text-muted-foreground">{r.sku ?? "—"}</div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {r.is_out_of_stock && <Badge variant="outline" className="bg-red-500/15 text-red-600 border-red-500/30">Out</Badge>}
                  {r.is_low_stock && <Badge variant="outline" className="bg-amber-500/15 text-amber-600 border-amber-500/30">Low</Badge>}
                  {r.is_overstock && <Badge variant="outline" className="bg-orange-500/15 text-orange-600 border-orange-500/30">Overstock</Badge>}
                  {r.is_dead_stock && <Badge variant="outline" className="bg-slate-500/15 text-slate-600 border-slate-500/30">Dead</Badge>}
                  {r.is_near_expiry && <Badge variant="outline" className="bg-red-500/15 text-red-600 border-red-500/30">Near expiry</Badge>}
                  {r.is_sales_spike && <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">Spike</Badge>}
                  {r.is_sales_drop && <Badge variant="outline" className="bg-red-500/15 text-red-600 border-red-500/30">Drop</Badge>}
                </div>
              </TableCell>
              <TableCell className="text-right">{fmtQty(r.stock)} {r.unit ?? ""}</TableCell>
              <TableCell className="text-right">{r.days_remaining == null ? "—" : `${Math.round(r.days_remaining)}d`}</TableCell>
              <TableCell className="text-right">{fmtQty(r.sales_qty_30d)}</TableCell>
              <TableCell className="text-right">{r.suggested_qty > 0 ? fmtQty(r.suggested_qty) : "—"}</TableCell>
              <TableCell className="text-right">
                <span className={r.health_score >= 70 ? "text-emerald-600" : r.health_score >= 40 ? "text-amber-600" : "text-red-600"}>
                  {r.health_score}%
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// ------------- REORDER TAB (edit min/max/safety/lead time/preferred supplier) -------------
function ReorderTab({ rows, sym, canWrite }: { rows: Intel[]; sym: string; canWrite: boolean }) {
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Intel | null>(null);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows.slice(0, 500);
    return rows.filter((r) => r.name.toLowerCase().includes(s) || r.sku?.toLowerCase().includes(s)).slice(0, 500);
  }, [rows, search]);

  return (
    <Card>
      <div className="p-3 border-b flex items-center gap-2">
        <Input placeholder="Search product…" className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-xs text-muted-foreground ml-auto">Showing {filtered.length} of {rows.length}</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Stock</TableHead>
            <TableHead className="text-right">Min</TableHead>
            <TableHead className="text-right">Max</TableHead>
            <TableHead className="text-right">Safety</TableHead>
            <TableHead className="text-right">Lead time</TableHead>
            <TableHead className="text-right">Suggested</TableHead>
            {canWrite && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
            <TableRow key={r.product_id}>
              <TableCell>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.sku ?? "—"}</div>
              </TableCell>
              <TableCell className="text-right">{fmtQty(r.stock)}</TableCell>
              <TableCell className="text-right">{r.min_stock ?? "—"}</TableCell>
              <TableCell className="text-right">{r.max_stock ?? "—"}</TableCell>
              <TableCell className="text-right">{r.safety_stock}</TableCell>
              <TableCell className="text-right">{r.lead_time_days}d</TableCell>
              <TableCell className="text-right font-semibold">{r.suggested_qty > 0 ? fmtQty(r.suggested_qty) : "—"}</TableCell>
              {canWrite && (
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEdit(r)}>Edit</Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit && <ReorderEditDialog product={edit} onClose={() => setEdit(null)} />}
      </Dialog>
    </Card>
  );
}

function ReorderEditDialog({ product, onClose }: { product: Intel; onClose: () => void }) {
  const qc = useQueryClient();
  const [minStock, setMinStock] = useState(String(product.min_stock ?? ""));
  const [maxStock, setMaxStock] = useState(String(product.max_stock ?? ""));
  const [safety, setSafety] = useState(String(product.safety_stock ?? 0));
  const [lead, setLead] = useState(String(product.lead_time_days ?? 7));
  const [reorder, setReorder] = useState(String(product.reorder_qty ?? ""));
  const [supplierId, setSupplierId] = useState(product.preferred_supplier_id ?? "");
  const [saving, setSaving] = useState(false);

  const suppliersQ = useQuery({
    queryKey: ["suppliers-picker"],
    queryFn: async () => {
      const { data, error } = { data: await fetchAll<any>((_f, _t) => supabase.from("suppliers").select("id,name").order("name").range(_f, _t) as any), error: null as any };
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("products").update({
      min_stock: minStock === "" ? null : Number(minStock),
      max_stock: maxStock === "" ? null : Number(maxStock),
      safety_stock: safety === "" ? 0 : Number(safety),
      lead_time_days: lead === "" ? 7 : Number(lead),
      reorder_qty: reorder === "" ? null : Number(reorder),
      preferred_supplier_id: supplierId || null,
    }).eq("id", product.product_id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Reorder settings saved");
    qc.invalidateQueries({ queryKey: ["product-intel"] });
    onClose();
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Reorder settings · {product.name}</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Min stock</Label><Input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} /></div>
        <div><Label className="text-xs">Max stock</Label><Input type="number" value={maxStock} onChange={(e) => setMaxStock(e.target.value)} /></div>
        <div><Label className="text-xs">Safety stock</Label><Input type="number" value={safety} onChange={(e) => setSafety(e.target.value)} /></div>
        <div><Label className="text-xs">Lead time (days)</Label><Input type="number" value={lead} onChange={(e) => setLead(e.target.value)} /></div>
        <div className="col-span-2"><Label className="text-xs">Fixed reorder qty (optional, overrides auto)</Label><Input type="number" value={reorder} onChange={(e) => setReorder(e.target.value)} /></div>
        <div className="col-span-2">
          <Label className="text-xs">Preferred supplier</Label>
          <Select value={supplierId || "none"} onValueChange={(v) => setSupplierId(v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {(suppliersQ.data ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        Auto suggestion = (avg daily × lead time) + safety − current stock. Avg daily last 30d: {product.avg_daily.toFixed(2)} {product.unit ?? ""}/d.
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>Save</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ------------- ABC -------------
function AbcTab({ rows, sym }: { rows: Intel[]; sym: string }) {
  const [cls, setCls] = useState<string>("all");
  const buckets = useMemo(() => {
    const g = { A: [] as Intel[], B: [] as Intel[], C: [] as Intel[] };
    for (const r of rows) g[r.abc_class].push(r);
    return g;
  }, [rows]);
  const filtered = cls === "all" ? rows : buckets[cls as "A" | "B" | "C"];
  const totalRev = rows.reduce((s, r) => s + r.revenue_90d, 0);
  const revByClass = { A: 0, B: 0, C: 0 };
  for (const r of rows) revByClass[r.abc_class] += r.revenue_90d;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {(["A", "B", "C"] as const).map((c) => (
          <Card key={c} className="p-3">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className={ABC_META[c]}>Class {c}</Badge>
              <span className="text-xs text-muted-foreground">{buckets[c].length} products</span>
            </div>
            <div className="mt-2 text-lg font-semibold">{fmtMoney(revByClass[c], sym)}</div>
            <div className="text-xs text-muted-foreground">
              {totalRev > 0 ? `${((revByClass[c] / totalRev) * 100).toFixed(1)}% of revenue` : "—"}
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <div className="p-3 border-b flex gap-2">
          {(["all", "A", "B", "C"] as const).map((k) => (
            <Button key={k} size="sm" variant={cls === k ? "default" : "outline"} onClick={() => setCls(k)}>{k === "all" ? "All" : `Class ${k}`}</Button>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Revenue 90d</TableHead>
              <TableHead className="text-right">Profit 90d</TableHead>
              <TableHead className="text-right">Sold 90d</TableHead>
              <TableHead>Velocity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 500).map((r) => {
              const vm = VELOCITY_META[r.velocity_class];
              const Icon = vm.icon;
              return (
                <TableRow key={r.product_id}>
                  <TableCell><Badge variant="outline" className={ABC_META[r.abc_class]}>{r.abc_class}</Badge></TableCell>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.sku ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-right">{fmtMoney(r.revenue_90d, sym)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.profit_90d, sym)}</TableCell>
                  <TableCell className="text-right">{fmtQty(r.sales_qty_90d)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={vm.classes}><Icon className="h-3 w-3 mr-1" />{vm.label}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ------------- VELOCITY -------------
function VelocityTab({ rows, sym }: { rows: Intel[]; sym: string }) {
  const [v, setV] = useState<string>("all");
  const filtered = v === "all" ? rows : rows.filter((r) => r.velocity_class === v);
  return (
    <Card>
      <div className="p-3 border-b flex gap-2 flex-wrap">
        {["all", "fast", "normal", "slow", "sleeping", "dead"].map((k) => (
          <Button key={k} size="sm" variant={v === k ? "default" : "outline"} onClick={() => setV(k)}>
            {k === "all" ? "All" : VELOCITY_META[k]?.label ?? k}
          </Button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Velocity</TableHead>
            <TableHead className="text-right">Avg/day</TableHead>
            <TableHead className="text-right">Avg/week</TableHead>
            <TableHead className="text-right">Avg/month</TableHead>
            <TableHead className="text-right">Stock</TableHead>
            <TableHead className="text-right">Days left</TableHead>
            <TableHead className="text-right">Turnover</TableHead>
            <TableHead>Last sale</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.slice(0, 500).map((r) => {
            const vm = VELOCITY_META[r.velocity_class];
            const Icon = vm.icon;
            return (
              <TableRow key={r.product_id}>
                <TableCell>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.sku ?? "—"}</div>
                </TableCell>
                <TableCell><Badge variant="outline" className={vm.classes}><Icon className="h-3 w-3 mr-1" />{vm.label}</Badge></TableCell>
                <TableCell className="text-right">{r.avg_daily.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.avg_weekly.toFixed(1)}</TableCell>
                <TableCell className="text-right">{fmtQty(r.avg_monthly)}</TableCell>
                <TableCell className="text-right">{fmtQty(r.stock)}</TableCell>
                <TableCell className="text-right">{r.days_remaining == null ? "—" : `${Math.round(r.days_remaining)}d`}</TableCell>
                <TableCell className="text-right">{r.inventory_turnover == null ? "—" : r.inventory_turnover.toFixed(2)}</TableCell>
                <TableCell className="text-xs">{r.last_sale_at ? format(new Date(r.last_sale_at), "PP") : "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

// ------------- PURCHASE SUGGESTIONS -------------
type Suggestion = {
  supplier_id: string | null;
  supplier_name: string | null;
  product_id: string;
  product_name: string;
  sku: string | null;
  unit: string | null;
  stock: number;
  avg_daily: number;
  days_remaining: number | null;
  velocity_class: string;
  abc_class: string;
  suggested_qty: number;
  cost_price: number | null;
  suggested_cost: number;
};

function SuggestionsTab({ sym }: { sym: string }) {
  const q = useQuery({
    queryKey: ["purchase-suggestions"],
    queryFn: async () => {
      const { data, error } = { data: await fetchAll<any>((_f, _t) => supabase
        .from("smart_purchase_suggestions" as any)
        .select("*")
        .order("suggested_cost", { ascending: false })
        .range(_f, _t) as any), error: null as any };
      if (error) throw error;
      return (data ?? []) as unknown as Suggestion[];
    },
  });

  const grouped = useMemo(() => {
    const g = new Map<string, { name: string; items: Suggestion[]; total: number }>();
    for (const r of q.data ?? []) {
      const key = r.supplier_id ?? "__none__";
      const bucket = g.get(key) ?? { name: r.supplier_name ?? "No preferred supplier", items: [], total: 0 };
      bucket.items.push(r);
      bucket.total += r.suggested_cost || 0;
      g.set(key, bucket);
    }
    return Array.from(g.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [q.data]);

  const exportCsv = () => {
    const rows = [["Supplier", "Product", "SKU", "Stock", "Days left", "Suggested qty", "Unit cost", "Est. total"]];
    for (const [, g] of grouped) {
      for (const it of g.items) {
        rows.push([g.name, it.product_name, it.sku ?? "", String(it.stock), it.days_remaining == null ? "" : String(Math.round(it.days_remaining)), String(it.suggested_qty), String(it.cost_price ?? ""), String(it.suggested_cost.toFixed(2))]);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchase-suggestions-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {grouped.length} supplier{grouped.length === 1 ? "" : "s"} · {(q.data?.length ?? 0)} items to reorder
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}><FileDown className="h-4 w-4 mr-1" /> Export CSV</Button>
      </div>
      {grouped.length === 0 && (
        <Card className="p-6 text-center text-muted-foreground">
          Nothing to reorder — every product is at healthy stock levels.
        </Card>
      )}
      {grouped.map(([key, g]) => (
        <Card key={key}>
          <div className="p-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              <div className="font-medium">{g.name}</div>
              <Badge variant="outline">{g.items.length} items</Badge>
            </div>
            <div className="text-sm font-semibold">{fmtMoney(g.total, sym)}</div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Avg/day</TableHead>
                <TableHead className="text-right">Days left</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Suggested</TableHead>
                <TableHead className="text-right">Est. cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {g.items.map((it) => (
                <TableRow key={it.product_id}>
                  <TableCell>
                    <Link to="/products/$id" params={{ id: it.product_id }} className="font-medium hover:underline">{it.product_name}</Link>
                    <div className="text-xs text-muted-foreground">{it.sku ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-right">{fmtQty(it.stock)} {it.unit ?? ""}</TableCell>
                  <TableCell className="text-right">{Number(it.avg_daily).toFixed(2)}</TableCell>
                  <TableCell className="text-right">{it.days_remaining == null ? "—" : `${Math.round(it.days_remaining)}d`}</TableCell>
                  <TableCell><Badge variant="outline" className={ABC_META[it.abc_class] ?? ""}>{it.abc_class}</Badge></TableCell>
                  <TableCell className="text-right font-semibold">{fmtQty(it.suggested_qty)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(it.suggested_cost, sym)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ))}
    </div>
  );
}
