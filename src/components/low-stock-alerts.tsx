import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, XCircle, X, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { fmtQty } from "@/lib/format";

const DISMISS_KEY = "low-stock-dismissed-v1";

type Row = {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  stock: number;
  low_stock_threshold: number;
  updated_at: string;
};

function readDismissed(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeDismissed(map: Record<string, string>) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {}
}

export function LowStockAlerts() {
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
        .select("id,name,sku,unit,stock,low_stock_threshold,updated_at")
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
      if (Number(p.stock) <= 0) oos.push(p);
      else low.push(p);
    }
    return { outOfStock: oos, lowStock: low };
  }, [data]);

  // Out-of-stock: sticky until dismissed (per product + last stock change)
  const activeOOS = outOfStock.filter((p) => dismissed[p.id] !== p.updated_at);

  useEffect(() => {
    if (activeOOS.length === 0 && lowStock.length === 0) setExpanded(false);
  }, [activeOOS.length, lowStock.length]);

  const dismissOne = (p: Row) => {
    const next = { ...dismissed, [p.id]: p.updated_at };
    setDismissed(next);
    writeDismissed(next);
  };

  const dismissAll = () => {
    const next = { ...dismissed };
    for (const p of outOfStock) next[p.id] = p.updated_at;
    setDismissed(next);
    writeDismissed(next);
  };

  const showLow = !lowHidden && lowStock.length > 0;
  if (activeOOS.length === 0 && !showLow) return null;

  const primary = activeOOS.length > 0;

  return (
    <div
      className={`no-print border-b ${
        primary
          ? "bg-destructive/10 border-destructive/30 text-destructive-foreground"
          : "bg-amber-500/10 border-amber-500/30"
      }`}
    >
      <div className="px-4 py-2 flex items-center gap-3 flex-wrap">
        {primary ? (
          <XCircle className="h-4 w-4 text-destructive shrink-0" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
        )}
        <div className="text-sm flex-1 min-w-0">
          {activeOOS.length > 0 && (
            <span className="font-medium text-destructive">
              {activeOOS.length} out of stock
            </span>
          )}
          {activeOOS.length > 0 && lowStock.length > 0 && (
            <span className="mx-2 text-muted-foreground">·</span>
          )}
          {lowStock.length > 0 && (
            <span className="text-amber-700 dark:text-amber-400 font-medium">
              {lowStock.length} low stock
            </span>
          )}
          <span className="text-muted-foreground ml-2 text-xs">
            (limits set per product)
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setExpanded((v) => !v)}
          className="h-7"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3 mr-1" /> Hide
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3 mr-1" /> View
            </>
          )}
        </Button>
        {activeOOS.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={dismissAll}
            className="h-7"
          >
            Dismiss all
          </Button>
        )}
        {activeOOS.length === 0 && lowStock.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLowHidden(true)}
            className="h-7"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-3 max-h-64 overflow-auto space-y-1">
          {activeOOS.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 text-sm bg-background/60 rounded px-2 py-1.5"
            >
              <Badge variant="destructive" className="text-[10px]">
                OUT
              </Badge>
              <Link
                to="/products"
                className="flex-1 truncate hover:underline"
              >
                {p.name}
                {p.sku ? (
                  <span className="text-muted-foreground"> · {p.sku}</span>
                ) : null}
              </Link>
              <span className="text-xs text-muted-foreground">
                {fmtQty(p.stock)} {p.unit ?? ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                onClick={() => dismissOne(p)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {lowStock.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 text-sm bg-background/60 rounded px-2 py-1.5"
            >
              <Badge
                variant="outline"
                className="text-[10px] border-amber-500 text-amber-700 dark:text-amber-400"
              >
                LOW
              </Badge>
              <Link
                to="/products"
                className="flex-1 truncate hover:underline"
              >
                {p.name}
                {p.sku ? (
                  <span className="text-muted-foreground"> · {p.sku}</span>
                ) : null}
              </Link>
              <span className="text-xs text-muted-foreground">
                {fmtQty(p.stock)} / {fmtQty(p.low_stock_threshold)} {p.unit ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
