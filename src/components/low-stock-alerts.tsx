import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, XCircle, X, ChevronDown, ChevronUp, Plus, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { fmtQty, fmtMoney } from "@/lib/format";
import { roundToTillixQty } from "@/lib/quantity-rounding";
import { useSettings } from "@/hooks/use-settings";
import { fetchAll } from "@/lib/supabase-page";

const DISMISS_KEY = "low-stock-dismissed-v1";

type Row = {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  category: string | null;
  sell_price: number;
  stock: number;
  low_stock_threshold: number;
  updated_at: string;
};

function readDismissed(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}"); } catch { return {}; }
}
function writeDismissed(map: Record<string, string>) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(map)); } catch {}
}

function AlertRow({
  p,
  kind,
  sym,
  onDismiss,
}: {
  p: Row;
  kind: "oos" | "low";
  sym: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [qty, setQty] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const saveStock = async () => {
    const add = roundToTillixQty(Number(qty));
    if (!add || add <= 0) return toast.error(t('low_stock.toast_enter_positive_qty', 'Enter a positive quantity'));
    setSaving(true);
    const newStock = Number(p.stock) + add;
    const { error } = await supabase
      .from("products")
      .update({ stock: newStock })
      .eq("id", p.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t('low_stock.toast_added_stock', 'Added {{qty}} {{unit}} to {{name}}', { qty: fmtQty(add), unit: p.unit ?? "", name: p.name }));
    setAdding(false);
    setQty("");
    qc.invalidateQueries({ queryKey: ["low-stock-alerts"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  return (
    <div className="bg-background/60 rounded px-2 py-1.5 space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <Badge
          variant={kind === "oos" ? "destructive" : "outline"}
          className={
            kind === "low"
              ? "text-[10px] border-amber-500 text-amber-700 dark:text-amber-400"
              : "text-[10px]"
          }
        >
          {kind === "oos" ? t('low_stock.badge_out', 'OUT') : t('low_stock.badge_low', 'LOW')}
        </Badge>
        <div className="flex-1 min-w-0">
          <div className="truncate font-medium">{p.name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {[p.sku, p.category].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <div className="text-xs text-right shrink-0">
          <div className={kind === "oos" ? "text-destructive font-medium" : "text-amber-700 dark:text-amber-400 font-medium"}>
            {fmtQty(p.stock)} {p.unit ?? ""}
          </div>
          <div className="text-muted-foreground">
            {t('low_stock.limit_line', 'limit {{limit}} · {{price}}', { limit: fmtQty(p.low_stock_threshold), price: fmtMoney(p.sell_price, sym) })}
          </div>
        </div>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3 w-3 mr-1" /> {t('low_stock.stock_button', 'Stock')}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onDismiss} title={t('low_stock.hide_this_alert', 'Hide this alert')}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      {adding && (
        <div className="flex items-center gap-2 pl-8">
          <Input
            type="number"
            step="0.001"
            autoFocus
            placeholder={t('low_stock.qty_to_add_placeholder', 'Qty to add ({{unit}})', { unit: p.unit ?? "pcs" })}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveStock(); }}
            className="h-8 max-w-[180px]"
          />
          <Button size="sm" className="h-8" onClick={saveStock} disabled={saving}>
            <Check className="h-3 w-3 mr-1" /> {t('low_stock.save', 'Save')}
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => { setAdding(false); setQty(""); }}>
            {t('low_stock.cancel', 'Cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function LowStockAlerts() {
  const { t } = useTranslation();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<Record<string, string>>(() =>
    typeof window !== "undefined" ? readDismissed() : {},
  );
  const [lowHidden, setLowHidden] = useState(false);

  const { data = [] } = useQuery({
    queryKey: ["low-stock-alerts"],
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<Row[]> => {
      // PostgREST cannot compare two columns, so `stock.lte.low_stock_threshold`
      // was a 400 (invalid numeric). Fetch a bounded low-stock window, then
      // apply the per-product threshold client-side.
      const { data, error } = await supabase
        .from("products")
        .select("id,name,sku,unit,category,sell_price,stock,low_stock_threshold,updated_at")
        .eq("is_active", true)
        .lte("stock", 100)
        .order("stock", { ascending: true })
        .limit(300);

      if (error) throw error;
      return ((data ?? []) as Row[]).filter(
        (p) => Number(p.stock) <= 0 || Number(p.stock) <= Number(p.low_stock_threshold ?? 5),
      ).slice(0, 100);
    },

    staleTime: 30_000,
    gcTime: 10 * 60_000,
  });


  const { outOfStock, lowStock } = useMemo(() => {
    const oos: Row[] = [];
    const low: Row[] = [];
    for (const p of data) {
      if (Number(p.stock) <= 0) oos.push(p); else low.push(p);
    }
    return { outOfStock: oos, lowStock: low };
  }, [data]);

  const activeOOS = outOfStock.filter((p) => dismissed[p.id] !== p.updated_at);
  const activeLow = lowHidden ? [] : lowStock.filter((p) => dismissed[p.id] !== p.updated_at);

  useEffect(() => {
    if (activeOOS.length === 0 && activeLow.length === 0) setExpanded(false);
  }, [activeOOS.length, activeLow.length]);

  const dismissOne = (p: Row) => {
    const next = { ...dismissed, [p.id]: p.updated_at };
    setDismissed(next);
    writeDismissed(next);
  };

  const dismissAll = () => {
    const next = { ...dismissed };
    for (const p of [...outOfStock, ...lowStock]) next[p.id] = p.updated_at;
    setDismissed(next);
    writeDismissed(next);
  };

  if (activeOOS.length === 0 && activeLow.length === 0) return null;
  const primary = activeOOS.length > 0;

  return (
    <div className={`no-print relative z-[500] rounded-md ${primary ? "bg-destructive/10" : "bg-amber-500/10"}`}>
      <div className="px-2 py-1 flex items-center gap-2 flex-wrap">
        {primary
          ? <XCircle className="h-4 w-4 text-destructive shrink-0" />
          : <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />}
        <div className="text-xs flex-1 min-w-0 truncate">
          {activeOOS.length > 0 && <span className="font-medium text-destructive">{t('low_stock.out_of_stock_count', '{{count}} out of stock', { count: activeOOS.length })}</span>}
          {activeOOS.length > 0 && activeLow.length > 0 && <span className="mx-2 text-muted-foreground">·</span>}
          {activeLow.length > 0 && <span className="text-amber-700 dark:text-amber-400 font-medium">{t('low_stock.low_stock_count', '{{count}} low stock', { count: activeLow.length })}</span>}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)} className="h-7">
          {expanded ? <><ChevronUp className="h-3 w-3 mr-1" /> {t('low_stock.hide', 'Hide')}</> : <><ChevronDown className="h-3 w-3 mr-1" /> {t('low_stock.view', 'View')}</>}
        </Button>
        <Button size="sm" variant="outline" onClick={dismissAll} className="h-7">{t('low_stock.dismiss_all', 'Dismiss all')}</Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { dismissAll(); setLowHidden(true); }}
          className="h-7"
          title={t('low_stock.hide_alert_bar', 'Hide alert bar')}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {expanded && (
        <div className={`absolute left-0 right-0 top-full mt-1 z-[999] rounded-md border bg-popover shadow-2xl ${primary ? "border-destructive/30" : "border-amber-500/30"} px-3 pb-3 pt-2 max-h-80 overflow-auto space-y-1`}>

          {activeOOS.map((p) => (
            <AlertRow key={p.id} p={p} kind="oos" sym={sym} onDismiss={() => dismissOne(p)} />
          ))}
          {activeLow.map((p) => (
            <AlertRow key={p.id} p={p} kind="low" sym={sym} onDismiss={() => dismissOne(p)} />
          ))}
        </div>
      )}
    </div>
  );
}
