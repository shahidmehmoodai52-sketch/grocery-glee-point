import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { roundToTillixQty } from "@/lib/quantity-rounding";
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
  const { t } = useTranslation();
  const { data: settings } = useSettings();
  const { isAdmin, can } = usePermissions();
  const sym = settings?.currency_symbol ?? "Rs";
  const canWrite = isAdmin || can("products");

  const intelQ = useQuery({
    queryKey: ["product-intel"],
    queryFn: async () => {
      const { data, error } = { data: await fetchAll<any>((from: number, to: number) => supabase
        .from("product_intelligence" as any)
        .select("*")
        .order("revenue_90d", { ascending: false })
        .range(from, to) as any), error: null as any };
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
      <NeedsInternetBanner section={t('intelligence.page_title', 'Inventory Intelligence')} />
      <PageHeader
        title={t('intelligence.page_title', 'Inventory Intelligence')}
        description={t('intelligence.page_desc', 'ABC classification, velocity, reorder suggestions & smart alerts. Updates automatically from sales.')}
        icon={<Brain className="h-5 w-5" />}
      />


      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <StatCard label={t('intelligence.stat_inventory_health', 'Inventory health')} value={`${Math.round(stats.avgHealth)}%`} tone={stats.avgHealth > 70 ? "green" : stats.avgHealth > 40 ? "amber" : "red"} />
          <StatCard label={t('intelligence.stat_inventory_value', 'Inventory value')} value={fmtMoney(stats.totalValue, sym)} tone="blue" />
          <StatCard label={t('intelligence.stat_dead_stock_value', 'Dead stock value')} value={fmtMoney(stats.deadValue, sym)} tone="red" />
          <StatCard label={t('intelligence.stat_overstock_value', 'Overstock value')} value={fmtMoney(stats.overstockValue, sym)} tone="amber" />
          <StatCard label={t('intelligence.stat_a_products', 'A products')} value={String(stats.abcCount.A)} tone="green" />
          <StatCard label={t('intelligence.stat_b_products', 'B products')} value={String(stats.abcCount.B)} tone="amber" />
          <StatCard label={t('intelligence.stat_fast_movers', 'Fast movers')} value={String(stats.velCount.fast || 0)} tone="green" />
          <StatCard label={t('intelligence.stat_suggested_po', 'Suggested PO')} value={`${stats.suggestedCount} · ${fmtMoney(stats.suggestedCost, sym)}`} tone="blue" />
        </div>
      )}

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">{t('intelligence.tab_alerts', 'Smart alerts')}</TabsTrigger>
          <TabsTrigger value="reorder">{t('intelligence.tab_reorder', 'Reorder')}</TabsTrigger>
          <TabsTrigger value="abc">{t('intelligence.tab_abc', 'ABC')}</TabsTrigger>
          <TabsTrigger value="velocity">{t('intelligence.tab_velocity', 'Velocity')}</TabsTrigger>
          <TabsTrigger value="suggestions">{t('intelligence.tab_suggestions', 'Purchase suggestions')}</TabsTrigger>
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
  const { t } = useTranslation();
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
          { k: "all", l: t('intelligence.filter_all', 'All ({{count}})', { count: stats ? Number(Object.values(stats.alerts).reduce((a: any, b: any) => Number(a) + Number(b), 0)) : 0 }) },
          { k: "out", l: t('intelligence.filter_count', '{{label}} {{count}}', { label: t('intelligence.alert_out', 'Out'), count: stats?.alerts.out ?? 0 }) },
          { k: "low", l: t('intelligence.filter_count', '{{label}} {{count}}', { label: t('intelligence.alert_low', 'Low'), count: stats?.alerts.low ?? 0 }) },
          { k: "overstock", l: t('intelligence.filter_count', '{{label}} {{count}}', { label: t('intelligence.alert_overstock', 'Overstock'), count: stats?.alerts.overstock ?? 0 }) },
          { k: "dead", l: t('intelligence.filter_count', '{{label}} {{count}}', { label: t('intelligence.alert_dead', 'Dead'), count: stats?.alerts.dead ?? 0 }) },
          { k: "near_expiry", l: t('intelligence.filter_count', '{{label}} {{count}}', { label: t('intelligence.alert_near_expiry', 'Near expiry'), count: stats?.alerts.near_expiry ?? 0 }) },
          { k: "spike", l: t('intelligence.filter_count', '{{label}} {{count}}', { label: t('intelligence.alert_spike', 'Spike'), count: stats?.alerts.spike ?? 0 }) },
          { k: "drop", l: t('intelligence.filter_count', '{{label}} {{count}}', { label: t('intelligence.alert_drop', 'Drop'), count: stats?.alerts.drop ?? 0 }) },
        ].map((f) => (
          <Button key={f.k} variant={type === f.k ? "default" : "outline"} size="sm" onClick={() => setType(f.k)}>{f.l}</Button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reports.th_product', 'Product')}</TableHead>
            <TableHead>{t('intelligence.th_alerts', 'Alerts')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_stock', 'Stock')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_days_left', 'Days left')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_30d_sales', '30d sales')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_suggested_qty', 'Suggested qty')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_health', 'Health')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="p-6 text-center text-muted-foreground">{t('intelligence.no_alerts', 'No alerts. Inventory is healthy.')}</TableCell></TableRow>}
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
                  {r.is_out_of_stock && <Badge variant="outline" className="bg-red-500/15 text-red-600 border-red-500/30">{t('intelligence.alert_out', 'Out')}</Badge>}
                  {r.is_low_stock && <Badge variant="outline" className="bg-amber-500/15 text-amber-600 border-amber-500/30">{t('intelligence.alert_low', 'Low')}</Badge>}
                  {r.is_overstock && <Badge variant="outline" className="bg-orange-500/15 text-orange-600 border-orange-500/30">{t('intelligence.alert_overstock', 'Overstock')}</Badge>}
                  {r.is_dead_stock && <Badge variant="outline" className="bg-slate-500/15 text-slate-600 border-slate-500/30">{t('intelligence.alert_dead', 'Dead')}</Badge>}
                  {r.is_near_expiry && <Badge variant="outline" className="bg-red-500/15 text-red-600 border-red-500/30">{t('intelligence.alert_near_expiry', 'Near expiry')}</Badge>}
                  {r.is_sales_spike && <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">{t('intelligence.alert_spike', 'Spike')}</Badge>}
                  {r.is_sales_drop && <Badge variant="outline" className="bg-red-500/15 text-red-600 border-red-500/30">{t('intelligence.alert_drop', 'Drop')}</Badge>}
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
  const { t } = useTranslation();
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
        <Input placeholder={t('intelligence.search_product_placeholder', 'Search product…')} className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-xs text-muted-foreground ml-auto">{t('intelligence.showing_of', 'Showing {{count}} of {{total}}', { count: filtered.length, total: rows.length })}</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reports.th_product', 'Product')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_stock', 'Stock')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_min', 'Min')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_max', 'Max')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_safety', 'Safety')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_lead_time', 'Lead time')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_suggested', 'Suggested')}</TableHead>
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
                  <Button variant="ghost" size="sm" onClick={() => setEdit(r)}>{t('intelligence.edit_btn', 'Edit')}</Button>
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
  const { t } = useTranslation();
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
      const { data, error } = { data: await fetchAll<any>((from: number, to: number) => supabase.from("suppliers").select("id,name").order("name").range(from, to) as any), error: null as any };
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("products").update({
      min_stock: minStock === "" ? null : roundToTillixQty(Number(minStock)),
      max_stock: maxStock === "" ? null : roundToTillixQty(Number(maxStock)),
      safety_stock: safety === "" ? 0 : roundToTillixQty(Number(safety)),
      lead_time_days: lead === "" ? 7 : Number(lead),
      reorder_qty: reorder === "" ? null : roundToTillixQty(Number(reorder)),
      preferred_supplier_id: supplierId || null,
    }).eq("id", product.product_id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t('intelligence.toast_reorder_saved', 'Reorder settings saved'));
    qc.invalidateQueries({ queryKey: ["product-intel"] });
    onClose();
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{t('intelligence.dialog_title', 'Reorder settings · {{name}}', { name: product.name })}</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">{t('intelligence.field_min_stock', 'Min stock')}</Label><Input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} /></div>
        <div><Label className="text-xs">{t('intelligence.field_max_stock', 'Max stock')}</Label><Input type="number" value={maxStock} onChange={(e) => setMaxStock(e.target.value)} /></div>
        <div><Label className="text-xs">{t('intelligence.field_safety_stock', 'Safety stock')}</Label><Input type="number" value={safety} onChange={(e) => setSafety(e.target.value)} /></div>
        <div><Label className="text-xs">{t('intelligence.field_lead_time', 'Lead time (days)')}</Label><Input type="number" value={lead} onChange={(e) => setLead(e.target.value)} /></div>
        <div className="col-span-2"><Label className="text-xs">{t('intelligence.field_fixed_reorder', 'Fixed reorder qty (optional, overrides auto)')}</Label><Input type="number" value={reorder} onChange={(e) => setReorder(e.target.value)} /></div>
        <div className="col-span-2">
          <Label className="text-xs">{t('intelligence.field_preferred_supplier', 'Preferred supplier')}</Label>
          <Select value={supplierId || "none"} onValueChange={(v) => setSupplierId(v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder={t('intelligence.select_supplier_placeholder', 'Select supplier')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('intelligence.none_option', 'None')}</SelectItem>
              {(suppliersQ.data ?? []).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        {t('intelligence.auto_suggestion_note', 'Auto suggestion = (avg daily × lead time) + safety − current stock. Avg daily last 30d: {{avg}} {{unit}}/d.', { avg: product.avg_daily.toFixed(2), unit: product.unit ?? "" })}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        <Button onClick={save} disabled={saving}>{t('common.save', 'Save')}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ------------- ABC -------------
function AbcTab({ rows, sym }: { rows: Intel[]; sym: string }) {
  const { t } = useTranslation();
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(["A", "B", "C"] as const).map((c) => (
          <Card key={c} className="p-3">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className={ABC_META[c]}>{t('intelligence.class_label', 'Class {{letter}}', { letter: c })}</Badge>
              <span className="text-xs text-muted-foreground">{t('intelligence.products_count', '{{count}} products', { count: buckets[c].length })}</span>
            </div>
            <div className="mt-2 text-lg font-semibold">{fmtMoney(revByClass[c], sym)}</div>
            <div className="text-xs text-muted-foreground">
              {totalRev > 0 ? t('intelligence.pct_of_revenue', '{{pct}}% of revenue', { pct: ((revByClass[c] / totalRev) * 100).toFixed(1) }) : "—"}
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <div className="p-3 border-b flex gap-2">
          {(["all", "A", "B", "C"] as const).map((k) => (
            <Button key={k} size="sm" variant={cls === k ? "default" : "outline"} onClick={() => setCls(k)}>{k === "all" ? t('intelligence.all_btn', 'All') : t('intelligence.class_label', 'Class {{letter}}', { letter: k })}</Button>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('intelligence.th_class', 'Class')}</TableHead>
              <TableHead>{t('reports.th_product', 'Product')}</TableHead>
              <TableHead className="text-right">{t('intelligence.th_revenue_90d', 'Revenue 90d')}</TableHead>
              <TableHead className="text-right">{t('intelligence.th_profit_90d', 'Profit 90d')}</TableHead>
              <TableHead className="text-right">{t('intelligence.th_sold_90d', 'Sold 90d')}</TableHead>
              <TableHead>{t('intelligence.th_velocity', 'Velocity')}</TableHead>
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
                    <Badge variant="outline" className={vm.classes}><Icon className="h-3 w-3 mr-1" />{t(`intelligence.velocity_${r.velocity_class}`, vm.label)}</Badge>
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
  const { t } = useTranslation();
  const [v, setV] = useState<string>("all");
  const filtered = v === "all" ? rows : rows.filter((r) => r.velocity_class === v);
  return (
    <Card>
      <div className="p-3 border-b flex gap-2 flex-wrap">
        {["all", "fast", "normal", "slow", "sleeping", "dead"].map((k) => (
          <Button key={k} size="sm" variant={v === k ? "default" : "outline"} onClick={() => setV(k)}>
            {k === "all" ? t('intelligence.all_btn', 'All') : t(`intelligence.velocity_${k}`, VELOCITY_META[k]?.label ?? k)}
          </Button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reports.th_product', 'Product')}</TableHead>
            <TableHead>{t('intelligence.th_velocity', 'Velocity')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_avg_day', 'Avg/day')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_avg_week', 'Avg/week')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_avg_month', 'Avg/month')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_stock', 'Stock')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_days_left', 'Days left')}</TableHead>
            <TableHead className="text-right">{t('intelligence.th_turnover', 'Turnover')}</TableHead>
            <TableHead>{t('intelligence.th_last_sale', 'Last sale')}</TableHead>
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
                <TableCell><Badge variant="outline" className={vm.classes}><Icon className="h-3 w-3 mr-1" />{t(`intelligence.velocity_${r.velocity_class}`, vm.label)}</Badge></TableCell>
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
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["purchase-suggestions"],
    queryFn: async () => {
      const { data, error } = { data: await fetchAll<any>((from: number, to: number) => supabase
        .from("smart_purchase_suggestions" as any)
        .select("*")
        .order("suggested_cost", { ascending: false })
        .range(from, to) as any), error: null as any };
      if (error) throw error;
      return (data ?? []) as unknown as Suggestion[];
    },
  });

  const grouped = useMemo(() => {
    const g = new Map<string, { name: string; items: Suggestion[]; total: number }>();
    for (const r of q.data ?? []) {
      const key = r.supplier_id ?? "__none__";
      const bucket: { name: string; items: Suggestion[]; total: number } = g.get(key) ?? { name: r.supplier_name ?? t('intelligence.no_preferred_supplier', 'No preferred supplier'), items: [], total: 0 };
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
          {t('intelligence.supplier_count', '{{count}} supplier(s)', { count: grouped.length })} · {t('intelligence.items_to_reorder', '{{count}} items to reorder', { count: q.data?.length ?? 0 })}
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}><FileDown className="h-4 w-4 mr-1" /> {t('cash_flow.export_csv', 'Export CSV')}</Button>
      </div>
      {grouped.length === 0 && (
        <Card className="p-6 text-center text-muted-foreground">
          {t('intelligence.nothing_to_reorder', 'Nothing to reorder — every product is at healthy stock levels.')}
        </Card>
      )}
      {grouped.map(([key, g]) => (
        <Card key={key}>
          <div className="p-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              <div className="font-medium">{g.name}</div>
              <Badge variant="outline">{t('intelligence.items_badge', '{{count}} items', { count: g.items.length })}</Badge>
            </div>
            <div className="text-sm font-semibold">{fmtMoney(g.total, sym)}</div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('reports.th_product', 'Product')}</TableHead>
                <TableHead className="text-right">{t('intelligence.th_stock', 'Stock')}</TableHead>
                <TableHead className="text-right">{t('intelligence.th_avg_day', 'Avg/day')}</TableHead>
                <TableHead className="text-right">{t('intelligence.th_days_left', 'Days left')}</TableHead>
                <TableHead>{t('intelligence.th_class', 'Class')}</TableHead>
                <TableHead className="text-right">{t('intelligence.th_suggested', 'Suggested')}</TableHead>
                <TableHead className="text-right">{t('intelligence.th_est_cost', 'Est. cost')}</TableHead>
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
