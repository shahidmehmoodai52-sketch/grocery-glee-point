import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  ArrowDownCircle,
  ArrowUpCircle,
  RotateCcw,
  Undo2,
  Package,
  SlidersHorizontal,
  AlertTriangle,
  Skull,
  CircleDot,
  Flag,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { usePermissions } from "@/hooks/use-permissions";
import { usePriceVisibility } from "@/hooks/use-price-visibility";
import { fmtMoney, fmtQty } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/products/$id")({
  component: ProductDetailPage,
});

type Movement = {
  id: string;
  product_id: string;
  movement_type: string;
  reference_type: string;
  reference_id: string | null;
  reference_no: string | null;
  qty_change: number;
  stock_before: number;
  stock_after: number;
  unit_cost: number | null;
  total_cost: number | null;
  user_id: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  reason: string | null;
  note: string | null;
  created_at: string;
};

const TYPE_META: Record<
  string,
  { label: string; classes: string; icon: any }
> = {
  purchase: {
    label: "Purchase",
    classes: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    icon: ArrowDownCircle,
  },
  sale: {
    label: "Sale",
    classes: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    icon: ArrowUpCircle,
  },
  sale_return: {
    label: "Sale Return",
    classes: "bg-cyan-500/15 text-cyan-600 border-cyan-500/30",
    icon: RotateCcw,
  },
  purchase_return: {
    label: "Purchase Return",
    classes: "bg-orange-500/15 text-orange-600 border-orange-500/30",
    icon: RotateCcw,
  },
  adjustment: {
    label: "Adjustment",
    classes: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    icon: SlidersHorizontal,
  },
  damaged: {
    label: "Damaged",
    classes: "bg-red-500/15 text-red-600 border-red-500/30",
    icon: AlertTriangle,
  },
  expired: {
    label: "Expired",
    classes: "bg-purple-500/15 text-purple-600 border-purple-500/30",
    icon: Skull,
  },
  opening_balance: {
    label: "Opening Balance",
    classes: "bg-muted text-muted-foreground border-border",
    icon: Flag,
  },
  undo_sale: {
    label: "Undo Sale",
    classes: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30",
    icon: Undo2,
  },
  lost: {
    label: "Lost",
    classes: "bg-red-500/15 text-red-600 border-red-500/30",
    icon: AlertTriangle,
  },
  transfer: {
    label: "Transfer",
    classes: "bg-slate-500/15 text-slate-600 border-slate-500/30",
    icon: Package,
  },
  stock_count: {
    label: "Stock Count",
    classes: "bg-slate-500/15 text-slate-600 border-slate-500/30",
    icon: CircleDot,
  },
};

function ProductDetailPage() {
  const { id } = useParams({ from: "/_authenticated/products/$id" });
  const { data: settings } = useSettings();
  const { isAdmin } = usePermissions();
  const { data: priceVisibility } = usePriceVisibility();
  const sym = settings?.currency_symbol ?? "Rs";
  const showCost = priceVisibility?.showCost ?? true;
  const showSell = priceVisibility?.showSell ?? true;

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [refSearch, setRefSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Movement | null>(null);
  const PAGE_SIZE = 50;

  const productQ = useQuery({
    queryKey: ["product", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const product = productQ.data;

  const movementsQ = useQuery({
    queryKey: [
      "product-movements",
      id,
      typeFilter,
      dateFrom,
      dateTo,
      refSearch,
      page,
    ],
    queryFn: async () => {
      let q = supabase
        .from("inventory_movements" as any)
        .select("*", { count: "exact" })
        .eq("product_id", id)
        .order("created_at", { ascending: false });
      if (typeFilter !== "all") q = q.eq("movement_type", typeFilter);
      if (dateFrom) q = q.gte("created_at", new Date(dateFrom).toISOString());
      if (dateTo) {
        const d = new Date(dateTo);
        d.setHours(23, 59, 59, 999);
        q = q.lte("created_at", d.toISOString());
      }
      if (refSearch.trim())
        q = q.ilike("reference_no", `%${refSearch.trim()}%`);
      q = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as Movement[], count: count ?? 0 };
    },
  });

  // Health metrics: pull last 90 days of sales/purchases for this product
  const healthQ = useQuery({
    queryKey: ["product-health", id],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const { data, error } = await supabase
        .from("inventory_movements" as any)
        .select("movement_type,qty_change,unit_cost,created_at")
        .eq("product_id", id)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const health = useMemo(() => {
    const rows = healthQ.data ?? [];
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const salesRows = rows.filter((r) => r.movement_type === "sale");
    const purchaseRows = rows.filter((r) => r.movement_type === "purchase");
    const last30Sales = salesRows
      .filter((r) => now - new Date(r.created_at).getTime() <= 30 * day)
      .reduce((s, r) => s + Math.abs(Number(r.qty_change) || 0), 0);
    const avgDaily = last30Sales / 30;
    const stock = Number(product?.stock ?? 0);
    const daysRemaining = avgDaily > 0 ? stock / avgDaily : null;
    const lastSale = salesRows[0]?.created_at ?? null;
    const lastPurchase = purchaseRows[0]?.created_at ?? null;
    const lastAdjustment =
      rows.find((r) => r.movement_type === "adjustment")?.created_at ?? null;

    const threshold = Number(product?.low_stock_threshold ?? 5);
    let status: "healthy" | "low" | "critical" | "dead" = "healthy";
    if (stock <= 0) status = "critical";
    else if (stock <= threshold) status = "low";
    else if (avgDaily === 0 && stock > 0) status = "dead";
    else status = "healthy";

    return {
      last30Sales,
      avgDaily,
      daysRemaining,
      lastSale,
      lastPurchase,
      lastAdjustment,
      status,
    };
  }, [healthQ.data, product]);

  const statusMeta = {
    healthy: {
      label: "Healthy",
      classes: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
      icon: TrendingUp,
    },
    low: {
      label: "Low",
      classes: "bg-amber-500/15 text-amber-600 border-amber-500/30",
      icon: TrendingDown,
    },
    critical: {
      label: "Critical",
      classes: "bg-red-500/15 text-red-600 border-red-500/30",
      icon: AlertTriangle,
    },
    dead: {
      label: "Dead Stock",
      classes: "bg-slate-500/15 text-slate-600 border-slate-500/30",
      icon: Skull,
    },
  }[health.status];

  const totalPages = Math.max(1, Math.ceil((movementsQ.data?.count ?? 0) / PAGE_SIZE));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/products">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Products
          </Button>
        </Link>
        <div className="ml-auto text-sm text-muted-foreground">
          {product?.sku ? `SKU · ${product.sku}` : null}
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{product?.name ?? "Product"}</h1>
          <p className="text-sm text-muted-foreground">
            {product?.category ?? "Uncategorized"}
            {product?.barcode ? ` · ${product.barcode}` : ""}
          </p>
        </div>
        {statusMeta && (
          <Badge variant="outline" className={statusMeta.classes}>
            <statusMeta.icon className="h-3.5 w-3.5 mr-1" />
            {statusMeta.label}
          </Badge>
        )}
      </div>

      {/* Health panel */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <HealthCard label="Current Stock" value={`${fmtQty(product?.stock ?? 0)} ${product?.unit ?? ""}`} />
        {showCost && (
          <HealthCard
            label="Inventory Value"
            value={fmtMoney(
              Number(product?.stock ?? 0) * Number(product?.cost_price ?? 0),
              sym,
            )}
          />
        )}
        <HealthCard label="Last Purchase" value={health.lastPurchase ? format(new Date(health.lastPurchase), "PP") : "—"} />
        <HealthCard label="Last Sale" value={health.lastSale ? format(new Date(health.lastSale), "PP") : "—"} />
        <HealthCard label="30-day Sales" value={fmtQty(health.last30Sales)} />
        <HealthCard label="Avg / day" value={fmtQty(health.avgDaily)} />
        <HealthCard
          label="Days Remaining"
          value={health.daysRemaining == null ? "—" : `${Math.round(health.daysRemaining)}d`}
        />
        <HealthCard
          label="Last Adjustment"
          value={health.lastAdjustment ? format(new Date(health.lastAdjustment), "PP") : "—"}
        />
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Movement type</Label>
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {Object.entries(TYPE_META).map(([k, m]) => (
                  <SelectItem key={k} value={k}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} />
          </div>
          <div>
            <Label className="text-xs">Invoice / Ref</Label>
            <Input placeholder="INV-…" value={refSearch} onChange={(e) => { setRefSearch(e.target.value); setPage(0); }} />
          </div>
        </div>
      </Card>

      {/* Timeline */}
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b flex items-center justify-between">
          <div className="font-medium">Stock Timeline</div>
          <div className="text-xs text-muted-foreground">
            {movementsQ.data?.count ?? 0} movements
          </div>
        </div>
        <div className="divide-y">
          {movementsQ.isLoading && (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
          )}
          {!movementsQ.isLoading && (movementsQ.data?.rows.length ?? 0) === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No movements match your filters.
            </div>
          )}
          {movementsQ.data?.rows.map((m) => {
            const meta = TYPE_META[m.movement_type] ?? TYPE_META.adjustment;
            const Icon = meta.icon;
            const positive = Number(m.qty_change) > 0;
            return (
              <button
                key={m.id}
                onClick={() => setSelected(m)}
                className="w-full text-left px-4 py-3 hover:bg-accent/40 flex items-center gap-3 transition"
              >
                <div className={`h-9 w-9 rounded-full flex items-center justify-center border ${meta.classes}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{meta.label}</span>
                    {m.reference_no && (
                      <Badge variant="outline" className="font-mono text-xs">
                        {m.reference_no}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {format(new Date(m.created_at), "PPp")}
                    {m.reason ? ` · ${m.reason}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-semibold ${positive ? "text-emerald-600" : "text-red-600"}`}>
                    {positive ? "+" : ""}{fmtQty(m.qty_change)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fmtQty(m.stock_before)} → {fmtQty(m.stock_after)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {totalPages > 1 && (
          <div className="p-3 border-t flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Page {page + 1} of {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      {/* Detail drawer */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {selected && (TYPE_META[selected.movement_type]?.label ?? "Movement")}
            </SheetTitle>
            <SheetDescription>
              {selected && format(new Date(selected.created_at), "PPpp")}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="mt-4 space-y-3 text-sm">
              <Row label="Reference" value={selected.reference_no ?? selected.reference_type} />
              <Row label="Quantity" value={`${Number(selected.qty_change) > 0 ? "+" : ""}${fmtQty(selected.qty_change)} ${product?.unit ?? ""}`} />
              <Row label="Stock before" value={fmtQty(selected.stock_before)} />
              <Row label="Stock after" value={fmtQty(selected.stock_after)} />
              {showCost && selected.unit_cost != null && (
                <Row label="Unit cost" value={fmtMoney(selected.unit_cost, sym)} />
              )}
              {showCost && selected.total_cost != null && (
                <Row label="Total cost" value={fmtMoney(selected.total_cost, sym)} />
              )}
              {isAdmin && showCost && showSell && selected.movement_type === "sale" && selected.unit_cost != null && (
                <Row
                  label="Profit (est.)"
                  value={fmtMoney(
                    (Number(product?.sell_price ?? 0) - Number(selected.unit_cost)) *
                      Math.abs(Number(selected.qty_change)),
                    sym,
                  )}
                />
              )}
              {selected.reason && <Row label="Reason" value={selected.reason} />}
              {selected.note && <Row label="Note" value={selected.note} />}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function HealthCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold truncate">{value}</div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}
