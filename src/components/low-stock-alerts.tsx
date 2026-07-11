import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, XCircle, X, ChevronDown, ChevronUp, Plus, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { fmtQty, fmtMoney } from "@/lib/format";
import { useSettings } from "@/hooks/use-settings";

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
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [qty, setQty] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const saveStock = async () => {
    const add = Number(qty);
    if (!add || add <= 0) return toast.error("Enter a positive quantity");
    setSaving(true);
    const newStock = Number(p.stock) + add;
    const { error } = await supabase
      .from("products")
      .update({ stock: newStock })
      .eq("id", p.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Added ${fmtQty(add)} ${p.unit ?? ""} to ${p.name}`);
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
          {kind === "oos" ? "OUT" : "LOW"}
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
            limit {fmtQty(p.low_stock_threshold)} · {fmtMoney(p.sell_price, sym)}
          </div>
        </div>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3 w-3 mr-1" /> Stock
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onDismiss} title="Hide this alert">
          <X className="h-3 w-3" />
        </Button>
      </div>
      {adding && (
        <div className="flex items-center gap-2 pl-8">
          <Input
            type="number"
            step="0.001"
            autoFocus
            placeholder={`Qty to add (${p.unit ?? "pcs"})`}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveStock(); }}
            className="h-8 max-w-[180px]"
          />
          <Button size="sm" className="h-8" onClick={saveStock} disabled={saving}>
            <Check className="h-3 w-3 mr-1" /> Save
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => { setAdding(false); setQty(""); }}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

export function LowStockAlerts() {
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<Record<string, string>>(() =>
    typeof window !== "undefined" ? readDismissed() : {},
  );
  const [lowHidden, setLowHidden] = useState(false);

  const { data = [] } = useQuery({
    queryKey: ["low-stock-alerts"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,sku,unit,category,sell_price,stock,low_stock_threshold,updated_at")
        .eq("is_active", true)
        .order("stock", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []).filter(
        (p: any) => Number(p.stock) <= Number(p.low_stock_threshold ?? 0),
      ) as Row[];
    },
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
    <div className={`no-print relative rounded-md ${primary ? "bg-destructive/10" : "bg-amber-500/10"}`}>
      <div className="px-2 py-1 flex items-center gap-2 flex-wrap">
        {primary
          ? <XCircle className="h-4 w-4 text-destructive shrink-0" />
          : <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />}
        <div className="text-xs flex-1 min-w-0 truncate">
          {activeOOS.length > 0 && <span className="font-medium text-destructive">{activeOOS.length} out of stock</span>}
          {activeOOS.length > 0 && activeLow.length > 0 && <span className="mx-2 text-muted-foreground">·</span>}
          {activeLow.length > 0 && <span className="text-amber-700 dark:text-amber-400 font-medium">{activeLow.length} low stock</span>}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)} className="h-7">
          {expanded ? <><ChevronUp className="h-3 w-3 mr-1" /> Hide</> : <><ChevronDown className="h-3 w-3 mr-1" /> View</>}
        </Button>
        <Button size="sm" variant="outline" onClick={dismissAll} className="h-7">Dismiss all</Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { dismissAll(); setLowHidden(true); }}
          className="h-7"
          title="Hide alert bar"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {expanded && (
        <div className={`absolute left-0 right-0 top-full mt-1 z-40 rounded-md border shadow-lg ${primary ? "bg-destructive/10 border-destructive/30" : "bg-amber-500/10 border-amber-500/30"} px-3 pb-3 pt-2 max-h-80 overflow-auto space-y-1`}>

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
