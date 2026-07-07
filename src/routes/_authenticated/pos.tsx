import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Search, Trash2, Printer, ShoppingCart, Loader2, Eye, EyeOff, History, Clock, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney, fmtQty } from "@/lib/format";
import { Receipt } from "@/components/receipt";
import { fetchAll } from "@/lib/supabase-page";


export const Route = createFileRoute("/_authenticated/pos")({
  component: POSPage,
});

type CartItem = {
  product_id: string | null;
  code: string;
  name: string;
  qty: number;
  price: number;     // Unit rate (editable)
  mrp: number;       // Original MRP / sell price
  cost: number;      // Purchase rate (internal only)
  disc_pct: number;  // line discount %
  tax_pct: number;   // line tax %
  disc: number;      // derived flat discount
};
type Tab = {
  id: string;
  name: string;
  items: CartItem[];
  customer_id: string | null;
  expense_person_id: string | null;
  payment_method: string;
  discount: number;
  discount_pct: string;
  paid: string;
  note: string;
};

const PRODUCT_COLUMNS = "id,name,sku,barcode,sell_price,cost_price,stock,unit,category";

const newTab = (n: number): Tab => ({
  id: crypto.randomUUID(),
  name: `Invoice ${n}`,
  items: [],
  customer_id: null,
  expense_person_id: null,
  payment_method: "cash",
  discount: 0,
  discount_pct: "",
  paid: "",
  note: "",
});

async function searchProducts(term: string) {
  const q = term.trim().replace(/\s+/g, " ");
  if (!q) return [];

  const like = `%${q}%`;
  const [nameRes, skuRes, barcodeRes, extraBarcodeRes] = await Promise.all([
    supabase.from("products").select(PRODUCT_COLUMNS).eq("is_active", true).ilike("name", like).order("name").limit(12),
    supabase.from("products").select(PRODUCT_COLUMNS).eq("is_active", true).ilike("sku", like).order("name").limit(12),
    supabase.from("products").select(PRODUCT_COLUMNS).eq("is_active", true).ilike("barcode", like).order("name").limit(12),
    supabase.from("product_barcodes").select("product_id,barcode").ilike("barcode", like).limit(24),
  ]);

  const firstError = nameRes.error ?? skuRes.error ?? barcodeRes.error ?? extraBarcodeRes.error;
  if (firstError) throw firstError;

  const matchedBarcodesByProduct: Record<string, string[]> = {};
  for (const row of extraBarcodeRes.data ?? []) {
    if (!matchedBarcodesByProduct[row.product_id]) matchedBarcodesByProduct[row.product_id] = [];
    matchedBarcodesByProduct[row.product_id].push(row.barcode);
  }

  const extraIds = Object.keys(matchedBarcodesByProduct);
  const extraProductsRes = extraIds.length
    ? await supabase.from("products").select(PRODUCT_COLUMNS).eq("is_active", true).in("id", extraIds).limit(24)
    : { data: [], error: null };
  if (extraProductsRes.error) throw extraProductsRes.error;

  const merged = new Map<string, any>();
  for (const p of [
    ...(nameRes.data ?? []),
    ...(skuRes.data ?? []),
    ...(barcodeRes.data ?? []),
    ...(extraProductsRes.data ?? []),
  ]) {
    merged.set(p.id, {
      ...p,
      _matched_barcodes: matchedBarcodesByProduct[p.id] ?? [],
    });
  }

  return Array.from(merged.values());
}


function POSPage() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "$";
  const taxRate = Number(settings?.tax_rate ?? 0);

  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(1)]);
  const [active, setActive] = useState<string>(() => tabs[0].id);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];

  const [search, setSearch] = useState("");
  const searchTerm = useMemo(() => search.trim().replace(/\s+/g, " "), [search]);
  const [lastInvoice, setLastInvoice] = useState<any>(null);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [reprintView, setReprintView] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCost, setShowCost] = useState(false);
  const [showStaff, setShowStaff] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState<{ idx: number; field: "price" | "qty" | "disc" } | null>(null);
  const [quickAdd, setQuickAdd] = useState<{
    open: boolean; barcode: string; name: string; unit: string;
    cost_price: string; sell_price: string; stock: string;
  }>({ open: false, barcode: "", name: "", unit: "pcs", cost_price: "", sell_price: "", stock: "1" });

  const openQuickAdd = (term: string) => {
    const raw = term.trim();
    // Detect scanner-style codes vs a name typed by hand
    const looksLikeBarcode = /^[0-9A-Za-z\-]{4,}$/.test(raw) && /\d/.test(raw);
    setQuickAdd({
      open: true,
      barcode: looksLikeBarcode ? raw : "",
      name: looksLikeBarcode ? "" : raw,
      unit: "pcs", cost_price: "", sell_price: "", stock: "1",
    });
  };

  const saveQuickAdd = async () => {
    const name = quickAdd.name.trim();
    if (!name) return toast.error("Item name is required");
    const sell = Number(quickAdd.sell_price || 0);
    const cost = Number(quickAdd.cost_price || 0);
    const stock = Number(quickAdd.stock || 0);
    const bc = quickAdd.barcode.trim() || null;
    const { data, error } = await supabase.from("products").insert({
      name, barcode: bc, unit: quickAdd.unit || "pcs",
      cost_price: cost, sell_price: sell, stock, tax_rate: 0, is_active: true,
    }).select(PRODUCT_COLUMNS).single();
    if (error) return toast.error(error.message);
    if (bc) {
      await supabase.from("product_barcodes").insert({ product_id: data.id, barcode: bc });
    }
    toast.success(`Added "${name}" to catalog`);
    addProduct(data);
    setQuickAdd({ open: false, barcode: "", name: "", unit: "pcs", cost_price: "", sell_price: "", stock: "1" });
    setSearch("");
    setTimeout(() => searchRef.current?.focus(), 0);
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product_barcodes"] });
  };



  
  const searchRef = useRef<HTMLInputElement>(null);
  const paidRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ["products", "active"],
    queryFn: async () =>
      fetchAll<any>((from, to) =>
        supabase
          .from("products")
          .select(PRODUCT_COLUMNS)
          .eq("is_active", true)
          .order("name")
          .range(from, to),
      ),
    staleTime: 5 * 60 * 1000,
  });

  const { data: remoteProducts = [], isFetching: remoteProductsLoading } = useQuery({
    queryKey: ["products", "pos-search", searchTerm],
    enabled: searchTerm.length > 0 && products.length === 0,
    queryFn: () => searchProducts(searchTerm),
    staleTime: 60 * 1000,
  });

  const searchableProducts = useMemo(
    () => (products.length > 0 ? products : remoteProducts),
    [products, remoteProducts],
  );

  const { data: extraBarcodes = [] } = useQuery({
    queryKey: ["product_barcodes"],
    queryFn: async () =>
      fetchAll<any>((from, to) =>
        supabase.from("product_barcodes").select("product_id,barcode").range(from, to),
      ),
  });


  // product_id -> array of all barcodes (primary + extras)
  const barcodesByProduct = useMemo(() => {
    const m: Record<string, string[]> = {};
    searchableProducts.forEach((p) => {
      const matched = Array.isArray(p._matched_barcodes) ? p._matched_barcodes.map(String) : [];
      m[p.id] = Array.from(new Set([...(p.barcode ? [String(p.barcode)] : []), ...matched]));
    });
    extraBarcodes.forEach((b: any) => {
      if (!m[b.product_id]) m[b.product_id] = [];
      if (!m[b.product_id].includes(b.barcode)) m[b.product_id].push(b.barcode);
    });
    return m;
  }, [searchableProducts, extraBarcodes]);

  // Exact-barcode lookup for scan
  const productByBarcode = useMemo(() => {
    const m: Record<string, any> = {};
    searchableProducts.forEach((p) => {
      (barcodesByProduct[p.id] ?? []).forEach((bc) => { m[bc] = p; });
    });
    return m;
  }, [searchableProducts, barcodesByProduct]);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id,name,balance").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: persons = [] } = useQuery({
    queryKey: ["expense_persons", "active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expense_persons")
        .select("id,name,role").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().replace(/\s+/g, " ").toLowerCase();
    if (!q) return [];
    // Score each product so best matches float to the top.
    // 0 = exact sku/barcode, 1 = sku/barcode prefix, 2 = name prefix,
    // 3 = word-start in name, 4 = name substring, 5 = sku/barcode substring,
    // 6 = category match. Lower is better.
    const scored: { p: any; s: number }[] = [];
    for (const p of searchableProducts) {
      const name = (p.name ?? "").toLowerCase();
      const sku = (p.sku ?? "").toLowerCase();
      const cat = (p.category ?? "").toLowerCase();
      const bcs = (barcodesByProduct[p.id] ?? []).map((b) => b.toLowerCase());

      let s = -1;
      if (sku === q || bcs.includes(q)) s = 0;
      else if (sku.startsWith(q) || bcs.some((b) => b.startsWith(q))) s = 1;
      else if (name.startsWith(q)) s = 2;
      else if (name.includes(" " + q)) s = 3;
      else if (name.includes(q)) s = 4;
      else if (sku.includes(q) || bcs.some((b) => b.includes(q))) s = 5;
      else if (cat.includes(q)) s = 6;

      if (s >= 0) scored.push({ p, s });
    }
    scored.sort((a, b) => a.s - b.s || a.p.name.localeCompare(b.p.name));
    return scored.slice(0, 12).map((x) => x.p);
  }, [searchableProducts, search, barcodesByProduct]);

  // reset highlight whenever the filtered list changes
  useEffect(() => { setHighlight(0); }, [search]);



  const setTab = (patch: Partial<Tab>) =>
    setTabs((ts) => ts.map((t) => (t.id === active ? { ...t, ...patch } : t)));

  const addProduct = (p: any): number => {
    const items = [...tab.items];
    const exIdx = items.findIndex((i) => i.product_id === p.id);
    let idx: number;
    if (exIdx >= 0) {
      items[exIdx] = { ...items[exIdx], qty: Number(items[exIdx].qty) + 1 };
      idx = exIdx;
    } else {
      items.push({
        product_id: p.id,
        code: p.sku ?? p.barcode ?? "",
        name: p.name,
        qty: 1,
        price: Number(p.sell_price),
        mrp: Number(p.sell_price),
        cost: Number(p.cost_price),
        disc_pct: 0,
        tax_pct: 0,
        disc: 0,
      });
      idx = items.length - 1;
    }
    setTab({ items });
    return idx;
  };

  const updateLine = (idx: number, patch: Partial<CartItem>) => {
    const items = tab.items.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, ...patch };
      const gross = Number(next.qty) * Number(next.price);
      if ("disc" in patch) {
        // flat discount typed directly — derive %
        next.disc = +Math.max(0, Number(patch.disc || 0)).toFixed(2);
        next.disc_pct = gross > 0 ? +((next.disc / gross) * 100).toFixed(2) : 0;
      } else {
        next.disc = +Math.max(0, (gross * Number(next.disc_pct || 0)) / 100).toFixed(2);
      }
      return next;
    });
    setTab({ items });
  };

  const removeLine = (idx: number) => setTab({ items: tab.items.filter((_, i) => i !== idx) });

  const subtotal = tab.items.reduce(
    (s, i) => s + Math.max(Number(i.qty) * Number(i.price) - Number(i.disc || 0), 0),
    0,
  );
  const lineDiscountTotal = tab.items.reduce((s, i) => s + Number(i.disc || 0), 0);
  // per-line tax sum (overrides global tax)
  const tax = +tab.items.reduce((s, i) => {
    const net = Math.max(Number(i.qty) * Number(i.price) - Number(i.disc || 0), 0);
    return s + (net * Number(i.tax_pct || 0)) / 100;
  }, 0).toFixed(2);
  const discount = Number(tab.discount || 0);
  const total = +(subtotal + tax - discount).toFixed(2);
  const paidNum = Number(tab.paid || 0);
  const change = Math.max(paidNum - total, 0);
  const due = Math.max(total - paidNum, 0);

  // Keep cart discount in sync when percentage is typed
  const applyDiscountPct = (pct: string) => {
    const n = Number(pct);
    if (!isFinite(n) || pct === "") {
      setTab({ discount_pct: pct });
      return;
    }
    const newDisc = +Math.max(0, (subtotal * n) / 100).toFixed(2);
    setTab({ discount_pct: pct, discount: newDisc });
  };


  const addTab = () => {
    const t = newTab(tabs.length + 1);
    setTabs((ts) => [...ts, t]);
    setActive(t.id);
  };
  const closeTab = (id: string) => {
    setTabs((ts) => {
      const next = ts.filter((t) => t.id !== id);
      const fallback = next.length ? next : [newTab(1)];
      if (id === active) setActive(fallback[0].id);
      return fallback;
    });
  };

  const handleSale = async () => {
    if (!tab.items.length) return toast.error("Cart is empty");
    const isCredit = due > 0;
    if (isCredit && !tab.customer_id && !tab.expense_person_id) return toast.error("Select a customer or a staff/owner for credit sale");
    await doSale();
  };

  const doSale = async () => {
    setSubmitting(true);
    try {
      const payload = {
        customer_id: tab.customer_id,
        expense_person_id: tab.expense_person_id,
        payment_method: tab.payment_method,
        tax,
        // Combine per-line discounts with cart-level discount so they reach the ledger.
        discount: +(lineDiscountTotal + discount).toFixed(2),
        paid: paidNum,
        note: tab.note,
        items: tab.items.map((i) => ({
          product_id: i.product_id,
          name: i.name,
          qty: i.qty,
          price: i.price,
          cost: i.cost,
        })),
      };

      const { data, error } = await supabase.rpc("complete_sale", { payload });
      if (error) throw error;
      const { data: sale } = await supabase
        .from("sales")
        .select("*, sale_items(*), customers(name,phone)")
        .eq("id", data as string)
        .maybeSingle();
      setLastInvoice(sale);

      toast.success(`Sale ${sale?.invoice_no} saved`, {
        action: { label: "Print", onClick: () => setReprintView(sale) },
        duration: 5000,
      });
      closeTab(active);
      setTimeout(() => searchRef.current?.focus(), 50);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense_persons"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to complete sale");
    } finally {
      setSubmitting(false);
    }
  };

  // Radix Dialog/Select sometimes leaves `pointer-events: none` on <body> after
  // closing quickly, freezing the entire page to mouse input. Clear it whenever
  // no overlay is actually open.
  useEffect(() => {
    const clearStuck = () => {
      const hasOverlay = document.querySelector('[role="dialog"][data-state="open"], [role="listbox"][data-state="open"], [data-radix-popper-content-wrapper]');
      if (!hasOverlay && document.body.style.pointerEvents === "none") {
        document.body.style.pointerEvents = "";
      }
    };
    const id = window.setInterval(clearStuck, 300);
    return () => window.clearInterval(id);
  }, []);


  // F2 add tab, F4 complete, and keep scanner/manual typing routed to search by default.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inDialog = !!target?.closest('[role="dialog"]');
      const selectOpen = !!document.querySelector('[role="listbox"]');
      const isSearchInput = target === searchRef.current;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        !!target?.isContentEditable;

      if (e.key === "F2") {
        e.preventDefault();
        e.stopPropagation();
        addTab();
        setSearch("");
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (e.key === "F4" && !inDialog) { e.preventDefault(); handleSale(); return; }

      if (inDialog || selectOpen || editing || e.ctrlKey || e.metaKey || e.altKey || isSearchInput || isEditableTarget) return;

      if (e.key.length === 1) {
        e.preventDefault();
        searchRef.current?.focus();
        setSearch((s) => `${s}${e.key}`);
        return;
      }

      if (e.key === "Backspace" && search) {
        e.preventDefault();
        searchRef.current?.focus();
        setSearch((s) => s.slice(0, -1));
        return;
      }

      if (e.key === "Escape" && search) {
        e.preventDefault();
        setSearch("");
        searchRef.current?.focus();
        return;
      }

      if (e.key === "Enter" && search.trim()) {
        e.preventDefault();
        const raw = search.trim();
        const exact = productByBarcode[raw];
        if (exact) {
          addProduct(exact);
          setSearch("");
          searchRef.current?.focus();
          return;
        }
        if (filtered.length >= 1) {
          const pick = filtered[Math.min(highlight, filtered.length - 1)] ?? filtered[0];
          addProduct(pick);
          setSearch("");
          searchRef.current?.focus();
          return;
        }
        openQuickAdd(raw);
      }

    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
      <div className="h-[calc(100vh-3rem)] flex flex-col overflow-hidden">
      {/* Top strip — open bills + clock + reprint (jahaan se sidebar khulti hai us patti ke saath) */}
        <div className="flex items-center gap-2 px-2 py-1 border-b bg-card/60 no-print shrink-0">
        <ScrollArea className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={`group flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs whitespace-nowrap ${
                  t.id === active ? "bg-background border-primary/40" : "bg-muted/40 text-muted-foreground hover:bg-muted"
                }`}
              >
                <ShoppingCart className="h-3 w-3" />
                <span>{t.name}</span>
                {t.items.length > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">{t.items.length}</Badge>
                )}
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
                  className="ml-0.5 rounded p-0.5 opacity-60 hover:opacity-100 hover:bg-destructive/20"
                >
                  <X className="h-3 w-3" />
                </span>
              </button>
            ))}
            <Button size="sm" variant="ghost" onClick={addTab} className="h-7 px-2 text-xs">
              <Plus className="h-3.5 w-3.5 mr-0.5" /> New (F2)
            </Button>
          </div>
        </ScrollArea>
        <div className="hidden sm:flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[11px] font-mono tabular-nums shrink-0">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span>{now.toLocaleTimeString()}</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => setReprintOpen(true)}>
          <History className="h-3.5 w-3.5 mr-1" /> Reprint
        </Button>
      </div>


      {/* Two-column layout */}
      <div className="flex-1 min-h-0 flex">
        {/* LEFT: items area (maximised) */}
        <main className="flex-1 flex flex-col min-h-0 bg-background">

        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30 no-print">
          {/* Search / scan */}
          <div className="relative flex-1 min-w-0 max-w-[440px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              autoFocus
              placeholder="Scan / search item (barcode, name, SKU)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setSearch(""); return; }
                if (e.key === "ArrowDown" && filtered.length) {
                  e.preventDefault(); setHighlight((h) => (h + 1) % filtered.length); return;
                }
                if (e.key === "ArrowUp" && filtered.length) {
                  e.preventDefault(); setHighlight((h) => (h - 1 + filtered.length) % filtered.length); return;
                }
                if (e.key !== "Enter") return;
                e.preventDefault();
                const raw = search.trim();
                if (!raw) { if (tab.items.length > 0) paidRef.current?.focus(); return; }
                const exact = productByBarcode[raw];
                if (exact) { addProduct(exact); setSearch(""); return; }
                if (filtered.length >= 1) {
                  const pick = filtered[Math.min(highlight, filtered.length - 1)] ?? filtered[0];
                  const idx = addProduct(pick); setSearch("");
                  setTimeout(() => setEditing({ idx, field: "qty" }), 0);
                  return;
                }
                openQuickAdd(raw);
              }}
              className="pl-9 h-9 text-sm"
            />

          </div>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <ShoppingCart className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">{tab.name}</span>
            <Badge variant="secondary" className="h-5 px-1.5 text-[11px] shrink-0">
              {tab.items.length} item{tab.items.length === 1 ? "" : "s"}
            </Badge>
            {tab.expense_person_id && (
              <Badge variant="outline" className="border-warning text-warning text-[11px] shrink-0">
                Staff purchase
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant={showCost ? "secondary" : "ghost"}
            className="h-7 text-xs shrink-0"
            onClick={() => setShowCost((v) => !v)}
          >
            {showCost ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
            {showCost ? "Hide" : "Show"} P.Rate
          </Button>
        </div>




        {/* Item-wise detailed table — FAST SALES style spreadsheet */}
        <div className="flex-1 min-h-0 overflow-auto bg-white dark:bg-background">
          <table className="w-full text-sm border-collapse [&_td]:border [&_th]:border [&_td]:border-border [&_th]:border-border">
            <thead className="sticky top-0 z-10 bg-[hsl(var(--muted))] text-[11px] uppercase tracking-wide">
              <tr>
                <th className="px-2 py-2 text-left w-16">Item No</th>
                <th className="px-2 py-2 text-left">Item Name</th>
                {showCost && (
                  <th className="px-2 py-2 text-right w-24 no-print" title="Purchase rate (internal)">P.Rate</th>
                )}
                <th className="px-2 py-2 text-right w-32">Unit Rate</th>
                <th className="px-2 py-2 text-right w-28">QTY</th>
                <th className="px-2 py-2 text-right w-32">Discount</th>
                <th className="px-2 py-2 text-right w-36">Amount</th>
                <th className="px-2 py-2 w-8 no-print"></th>
              </tr>
            </thead>
            <tbody>
              {tab.items.length === 0 && (
                <tr>
                  <td colSpan={showCost ? 8 : 7} className="text-center text-muted-foreground py-16 border-0">
                    Scan barcode ya product search karen — same item dobara scan hone par usi row me Qty +1 ho jaye gi.
                  </td>
                </tr>
              )}
              {tab.items.map((it, idx) => {
                const gross = Number(it.qty) * Number(it.price);
                const lineDisc = Number(it.disc || 0);
                const net = Math.max(gross - lineDisc, 0);
                const amount = net;
                const zebra = idx % 2 === 0 ? "bg-amber-50/60 dark:bg-muted/20" : "bg-white dark:bg-background";
                const p = it.product_id ? searchableProducts.find((x) => x.id === it.product_id) : null;
                const bcs = p ? (barcodesByProduct[p.id] ?? []) : [];
                const subline = p
                  ? [
                      p.sku ? `SKU ${p.sku}` : null,
                      bcs[0] ? `BC ${bcs[0]}` : null,
                      p.category || null,
                    ].filter(Boolean).join(" · ")
                  : "";
                const stockNum = p ? Number(p.stock ?? 0) : null;
                return (
                  <tr key={idx} className={`${zebra} hover:bg-amber-100/60 dark:hover:bg-muted/40`}>
                    <td className="px-2 py-1 font-mono text-xs">{it.code || String(idx + 1).padStart(3, "0")}</td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="font-medium text-sm truncate min-w-0 flex-1">{it.name}</div>
                        {stockNum !== null && (
                          <Badge variant={stockNum > 0 ? "outline" : "destructive"} className="font-normal shrink-0 text-[10px]">
                            {fmtQty(stockNum)} {p?.unit ?? ""}
                          </Badge>
                        )}
                      </div>
                      {subline && (
                        <div className="text-[11px] text-muted-foreground truncate">{subline}</div>
                      )}
                    </td>
                    {showCost && (
                      <td className="px-2 py-1 text-right font-mono text-muted-foreground no-print">
                        {fmtMoney(it.cost, sym)}
                      </td>
                    )}
                    <td className="p-0">
                      <EditableNumCell
                        active={editing?.idx === idx && editing.field === "price"}
                        value={it.price}
                        step="0.01"
                        display={fmtMoney(it.price, sym)}
                        onActivate={() => setEditing({ idx, field: "price" })}
                        onCommit={(v) => { updateLine(idx, { price: v }); setEditing(null); searchRef.current?.focus(); }}
                        onCancel={() => { setEditing(null); searchRef.current?.focus(); }}
                      />
                    </td>
                    <td className="p-0">
                      <EditableNumCell
                        active={editing?.idx === idx && editing.field === "qty"}
                        value={it.qty}
                        step="0.001"
                        display={fmtQty(it.qty)}
                        onActivate={() => setEditing({ idx, field: "qty" })}
                        onCommit={(v) => { updateLine(idx, { qty: v }); setEditing(null); searchRef.current?.focus(); }}
                        onCancel={() => { setEditing(null); searchRef.current?.focus(); }}
                      />
                    </td>
                    <td className="p-0">
                      <EditableNumCell
                        active={editing?.idx === idx && editing.field === "disc"}
                        value={it.disc}
                        step="0.01"
                        min={0}
                        display={fmtMoney(it.disc, sym)}
                        onActivate={() => setEditing({ idx, field: "disc" })}
                        onCommit={(v) => { updateLine(idx, { disc: Math.max(0, v) }); setEditing(null); searchRef.current?.focus(); }}
                        onCancel={() => { setEditing(null); searchRef.current?.focus(); }}
                      />
                    </td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{fmtMoney(amount, sym)}</td>
                    <td className="px-1 py-1 text-center no-print border-0">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeLine(idx)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                );
              })}

              {search.trim() && filtered.length > 0 && filtered.map((p, i) => {
                const rate = Number(p.sell_price ?? 0);
                const pRate = Number(p.cost_price ?? 0);
                const code = p.sku || p.barcode || "—";
                const bcs = barcodesByProduct[p.id] ?? [];
                const subline = [
                  p.sku ? `SKU ${p.sku}` : null,
                  bcs[0] ? `BC ${bcs[0]}` : null,
                  p.category || null,
                ].filter(Boolean).join(" · ");
                const stockNum = Number(p.stock ?? 0);
                const isHi = i === highlight;
                return (
                  <tr
                    key={`search-${p.id}`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => { const idx = addProduct(p); setSearch(""); setTimeout(() => setEditing({ idx, field: "qty" }), 0); }}
                    className={`cursor-pointer ${isHi ? "bg-primary/15" : "bg-sky-50/60 dark:bg-sky-950/20 hover:bg-primary/10"}`}
                  >
                    <td className="px-2 py-1 font-mono text-xs">{code}</td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="font-medium text-sm truncate min-w-0 flex-1">{p.name}</div>
                        <Badge variant={stockNum > 0 ? "outline" : "destructive"} className="font-normal shrink-0 text-[10px]">
                          {fmtQty(stockNum)} {p.unit ?? ""}
                        </Badge>
                      </div>
                      {subline && (
                        <div className="text-[11px] text-muted-foreground truncate">{subline}</div>
                      )}
                    </td>
                    {showCost && (
                      <td className="px-2 py-1 text-right font-mono text-muted-foreground no-print">
                        {fmtMoney(pRate, sym)}
                      </td>
                    )}
                    <td className="px-2 py-1 text-right tabular-nums text-sm">{fmtMoney(rate, sym)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-sm">1</td>
                    <td className="px-2 py-1 text-right tabular-nums text-sm">{fmtMoney(0, sym)}</td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{fmtMoney(rate, sym)}</td>
                    <td className="px-1 py-1 text-center no-print border-0">
                      <Plus className="h-3.5 w-3.5 mx-auto text-primary" />
                    </td>
                  </tr>
                );
              })}

              {search.trim() && filtered.length === 0 && (
                <tr>
                  <td colSpan={showCost ? 8 : 7} className="text-center py-6 border-0">
                    {productsLoading || remoteProductsLoading ? (
                      <span className="inline-flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading products…
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-3 text-sm">
                        <span className="text-muted-foreground">No match for "{search}".</span>
                        <Button size="sm" onClick={() => openQuickAdd(search)}>
                          <Plus className="h-4 w-4 mr-1" /> Add
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* RIGHT: side panel — open bills, party, payment, totals */}
      <aside className="w-[280px] md:w-[320px] lg:w-[360px] xl:w-[380px] shrink-0 border-l bg-card flex flex-col min-h-0 overflow-hidden no-print">

        {/* Party + payment */}
        <div className="p-3 border-b space-y-2.5 shrink-0">
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Customer</Label>
              {tab.customer_id && (
                <Link
                  to="/customers/$id"
                  params={{ id: tab.customer_id }}
                  className="text-xs text-primary hover:underline"
                >
                  View ledger →
                </Link>
              )}
            </div>
            <Select
              value={tab.customer_id ?? "walkin"}
              onValueChange={(v) => {
                const isWalkin = v === "walkin";
                setTab({
                  customer_id: isWalkin ? null : v,
                  // Auto-switch: named customer → credit, walk-in → cash
                  payment_method: isWalkin ? "cash" : "credit",
                });
                setTimeout(() => searchRef.current?.focus(), 0);
              }}
            >
              <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="walkin">Walk-in customer</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} {Number(c.balance) > 0 ? `· owes ${fmtMoney(c.balance, sym)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(showStaff || tab.expense_person_id) && (
            <div>
              <Label className="text-xs text-muted-foreground">Staff / Owner purchase</Label>
              <Select
                value={tab.expense_person_id ?? "none"}
                onValueChange={(v) => {
                  setTab({
                    expense_person_id: v === "none" ? null : v,
                    customer_id: v === "none" ? tab.customer_id : null,
                  });
                  setTimeout(() => searchRef.current?.focus(), 0);
                }}
              >
                <SelectTrigger className={`h-9 mt-1 ${tab.expense_person_id ? "border-warning ring-1 ring-warning/40" : ""}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Not staff purchase —</SelectItem>
                  {persons.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} {p.role ? `· ${p.role}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
            <div>
              <Label className="text-xs text-muted-foreground">Payment</Label>
              <Select value={tab.payment_method} onValueChange={(v) => { setTab({ payment_method: v }); setTimeout(() => searchRef.current?.focus(), 0); }}>
                <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank">Bank transfer</SelectItem>
                  <SelectItem value="credit">Credit (later)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              size="sm"
              variant={showStaff || tab.expense_person_id ? "secondary" : "outline"}
              className="h-9"
              title="Charge this bill to a staff/owner expense ledger"
              onClick={() => {
                if (tab.expense_person_id) setTab({ expense_person_id: null });
                setShowStaff((v) => !v);
                setTimeout(() => searchRef.current?.focus(), 0);
              }}
            >
              <UserCog className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Totals + discount + paid + note */}
        <div className="flex-1 min-h-0 overflow-hidden p-3 space-y-2 bg-muted/20">
          <Row label="Gross" value={fmtMoney(subtotal + lineDiscountTotal, sym)} muted />
          {lineDiscountTotal > 0 && (
            <Row label="Line discounts" value={`- ${fmtMoney(lineDiscountTotal, sym)}`} muted />
          )}
          <Row label="Subtotal" value={fmtMoney(subtotal, sym)} />

          <div className="flex items-center justify-between text-sm gap-2">
            <span className="text-muted-foreground">Discount</span>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <Input
                  type="number"
                  step="0.01"
                  value={tab.discount_pct}
                  onChange={(e) => applyDiscountPct(e.target.value)}
                  placeholder="0"
                  className="h-8 w-16 text-right text-sm pr-5"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
              </div>
              <Input
                type="number"
                step="0.01"
                value={tab.discount}
                onChange={(e) => setTab({ discount: Number(e.target.value), discount_pct: "" })}
                className="h-8 w-24 text-right text-sm"
              />
            </div>
          </div>

          <div className="flex justify-between items-center border-t-2 border-foreground/20 pt-2 mt-1">
            <span className="text-base font-semibold">Grand Total</span>
            <span className="text-xl font-bold text-primary">{fmtMoney(total, sym)}</span>
          </div>

          <div className="pt-1">
            <Label className="text-xs text-muted-foreground">Paid</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input
                ref={paidRef}
                type="number"
                step="0.01"
                value={tab.paid}
                onChange={(e) => setTab({ paid: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleSale(); }
                }}
                placeholder={total.toFixed(2)}
                className="h-9 flex-1 text-sm"
              />
              <button
                onClick={() => setTab({ paid: total.toFixed(2) })}
                className="text-xs text-primary hover:underline shrink-0"
              >
                Exact
              </button>
            </div>
            <div className="text-xs mt-1">
              {due > 0
                ? <span className="text-destructive font-medium">Due: {fmtMoney(due, sym)}</span>
                : <span className="text-success font-medium">Change: {fmtMoney(change, sym)}</span>}
            </div>
          </div>

          <Input
            value={tab.note}
            onChange={(e) => setTab({ note: e.target.value })}
            placeholder="Note / House #, street…"
            className="h-8 text-xs"
          />

          {tab.items.length > 0 && (() => {
            const cartCost = tab.items.reduce((s, i) => s + Number(i.qty) * Number(i.cost), 0);
            const cartProfit = subtotal - discount - cartCost;
            const net = subtotal - discount;
            const pct = net > 0 ? (cartProfit / net) * 100 : 0;
            return (
              <div className="rounded-md border border-dashed bg-background/60 px-2 py-1 text-[11px] flex items-center justify-between">
                <span className="text-muted-foreground">Cost <span className="font-mono">{fmtMoney(cartCost, sym)}</span></span>
                <span className={`font-semibold ${cartProfit >= 0 ? "text-success" : "text-destructive"}`}>
                  Profit {fmtMoney(cartProfit, sym)} ({pct.toFixed(1)}%)
                </span>
              </div>
            );
          })()}
        </div>

        {/* Footer — Complete sale */}
        <div className="p-3 border-t bg-card shrink-0">
          <Button className="w-full h-11 text-sm font-semibold" onClick={handleSale} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Complete Sale (F4)
          </Button>
        </div>


      </aside>
      </div>




      {/* Reprint browser */}
      <ReprintDialog
        open={reprintOpen}
        onOpenChange={setReprintOpen}
        settings={settings}
        sym={sym}
        onView={(s: any) => setReprintView(s)}
      />

      {/* Single invoice viewer (used by both reprint and the post-sale toast action) */}
      <InvoiceDialog
        invoice={reprintView}
        settings={settings}
        onClose={() => setReprintView(null)}
      />

      {/* Quick-add product dialog — for scanned/typed items not yet in catalog */}
      <Dialog open={quickAdd.open} onOpenChange={(v) => setQuickAdd((q) => ({ ...q, open: v }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add new item to catalog</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Item name</Label>
              <Input
                autoFocus
                value={quickAdd.name}
                onChange={(e) => setQuickAdd((q) => ({ ...q, name: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveQuickAdd(); } }}
              />
            </div>
            <div className="col-span-2">
              <Label>Barcode</Label>
              <Input
                value={quickAdd.barcode}
                onChange={(e) => setQuickAdd((q) => ({ ...q, barcode: e.target.value }))}
              />
            </div>
            <div>
              <Label>Unit</Label>
              <Input value={quickAdd.unit} onChange={(e) => setQuickAdd((q) => ({ ...q, unit: e.target.value }))} />
            </div>
            <div>
              <Label>Stock</Label>
              <Input type="number" step="0.001" value={quickAdd.stock}
                onChange={(e) => setQuickAdd((q) => ({ ...q, stock: e.target.value }))} />
            </div>
            <div>
              <Label>Purchase rate</Label>
              <Input type="number" step="0.01" value={quickAdd.cost_price}
                onChange={(e) => setQuickAdd((q) => ({ ...q, cost_price: e.target.value }))} />
            </div>
            <div>
              <Label>Sell price</Label>
              <Input type="number" step="0.01" value={quickAdd.sell_price}
                onChange={(e) => setQuickAdd((q) => ({ ...q, sell_price: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setQuickAdd((q) => ({ ...q, open: false }))}>Cancel</Button>
            <Button onClick={saveQuickAdd}>Save & add to bill</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suppress unused-var warning while keeping lastInvoice for potential future quick-print */}
      {false && lastInvoice}
    </div>
  );
}



function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className={muted ? "" : "font-medium"}>{value}</span>
    </div>
  );
}

function InvoiceDialog({ invoice, settings, onClose }: any) {
  if (!invoice) return null;
  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Invoice {invoice.invoice_no}</DialogTitle>
        </DialogHeader>
        <div className="bg-muted/30 rounded p-3 max-h-[70vh] overflow-auto">
          <div className="print-area">
            <Receipt invoice={invoice} settings={settings} />
          </div>
        </div>
        <DialogFooter className="no-print">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />Print</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReprintDialog({
  open,
  onOpenChange,
  settings,
  sym,
  onView,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  settings: any;
  sym: string;
  onView: (s: any) => void;
}) {
  const [q, setQ] = useState("");

  const { data: sales = [], isFetching } = useQuery({
    queryKey: ["sales", "reprint"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, customers(name), sale_items(*)")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return sales.slice(0, 50);
    const asNum = Number(term);
    const isNum = isFinite(asNum) && term !== "";
    return sales.filter((s: any) => {
      if (String(s.invoice_no ?? "").toLowerCase().includes(term)) return true;
      if ((s.customers?.name ?? "").toLowerCase().includes(term)) return true;
      if ((s.payment_method ?? "").toLowerCase().includes(term)) return true;
      if (isNum) {
        // amount match — tolerate within 1 unit so user can type 250 to find 250.00
        if (Math.abs(Number(s.total) - asNum) < 1) return true;
        if (Math.abs(Number(s.paid) - asNum) < 1) return true;
      }
      return false;
    });
  }, [q, sales]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reprint / past invoices</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Search by invoice no, customer, or amount (e.g. 250)…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 h-10"
            />
          </div>
          <div className="rounded-md border max-h-[55vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Invoice</th>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Customer</th>
                  <th className="text-right px-3 py-2">Total</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {isFetching && (
                  <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">Loading…</td></tr>
                )}
                {!isFetching && filtered.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No invoices match.</td></tr>
                )}
                {filtered.map((s: any) => (
                  <tr key={s.id} className="border-t hover:bg-accent/40">
                    <td className="px-3 py-1.5 font-mono text-xs">{s.invoice_no}</td>
                    <td className="px-3 py-1.5 text-xs">{new Date(s.created_at).toLocaleString()}</td>
                    <td className="px-3 py-1.5">{s.customers?.name ?? "Walk-in"}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{fmtMoney(s.total, sym)}</td>
                    <td className="px-2 py-1 text-right">
                      <Button size="sm" variant="ghost" onClick={() => { onView(s); onOpenChange(false); }}>
                        <Printer className="h-3.5 w-3.5 mr-1" /> Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditableNumCell({
  active,
  value,
  step,
  min,
  display,
  onActivate,
  onCommit,
  onCancel,
}: {
  active: boolean;
  value: number;
  step?: string;
  min?: number;
  display: string;
  onActivate: () => void;
  onCommit: (v: number) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (active) {
      setDraft(String(value));
      setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 0);
    }
  }, [active, value]);

  if (!active) {
    return (
      <button
        type="button"
        onClick={onActivate}
        className="h-8 w-full px-2 text-right text-sm tabular-nums hover:bg-accent/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        title="Click to edit"
      >
        {display}
      </button>
    );
  }
  return (
    <Input
      ref={ref}
      type="number"
      step={step}
      min={min}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(Number(draft))}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onCommit(Number(draft)); }
        else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
      className="h-8 w-full text-right text-sm rounded-none border-0 focus-visible:ring-1"
    />
  );
}


