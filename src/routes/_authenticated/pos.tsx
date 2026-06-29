import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Search, Trash2, Printer, ShoppingCart, Loader2, Eye, EyeOff, History, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney, fmtQty } from "@/lib/format";
import { Receipt } from "@/components/receipt";


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
  payment_method: string;
  discount: number;
  discount_pct: string;
  paid: string;
  note: string;
};

const newTab = (n: number): Tab => ({
  id: crypto.randomUUID(),
  name: `Invoice ${n}`,
  items: [],
  customer_id: null,
  payment_method: "cash",
  discount: 0,
  discount_pct: "",
  paid: "",
  note: "",
});


function POSPage() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "$";
  const taxRate = Number(settings?.tax_rate ?? 0);

  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(1)]);
  const [active, setActive] = useState<string>(() => tabs[0].id);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];

  const [search, setSearch] = useState("");
  const [lastInvoice, setLastInvoice] = useState<any>(null);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [reprintView, setReprintView] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCost, setShowCost] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const searchRef = useRef<HTMLInputElement>(null);
  const paidRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: products = [] } = useQuery({
    queryKey: ["products", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,sku,barcode,sell_price,cost_price,stock,unit")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: extraBarcodes = [] } = useQuery({
    queryKey: ["product_barcodes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("product_barcodes").select("product_id,barcode");
      if (error) throw error;
      return data ?? [];
    },
  });

  // product_id -> array of all barcodes (primary + extras)
  const barcodesByProduct = useMemo(() => {
    const m: Record<string, string[]> = {};
    products.forEach((p) => {
      m[p.id] = p.barcode ? [String(p.barcode)] : [];
    });
    extraBarcodes.forEach((b: any) => {
      if (!m[b.product_id]) m[b.product_id] = [];
      if (!m[b.product_id].includes(b.barcode)) m[b.product_id].push(b.barcode);
    });
    return m;
  }, [products, extraBarcodes]);

  // Exact-barcode lookup for scan
  const productByBarcode = useMemo(() => {
    const m: Record<string, any> = {};
    products.forEach((p) => {
      (barcodesByProduct[p.id] ?? []).forEach((bc) => { m[bc] = p; });
    });
    return m;
  }, [products, barcodesByProduct]);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id,name,balance").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => {
        if (p.name.toLowerCase().includes(q)) return true;
        if ((p.sku ?? "").toLowerCase().includes(q)) return true;
        const bcs = barcodesByProduct[p.id] ?? [];
        return bcs.some((bc) => bc.toLowerCase().includes(q));
      })
      .slice(0, 8);
  }, [products, search, barcodesByProduct]);

  // reset highlight whenever the filtered list changes
  useEffect(() => { setHighlight(0); }, [search]);



  const setTab = (patch: Partial<Tab>) =>
    setTabs((ts) => ts.map((t) => (t.id === active ? { ...t, ...patch } : t)));

  const addProduct = (p: any) => {
    const items = [...tab.items];
    const ex = items.find((i) => i.product_id === p.id);
    if (ex) ex.qty = Number(ex.qty) + 1;
    else items.push({
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
    setTab({ items });
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
    if (due > 0 && !tab.customer_id) return toast.error("Select a customer for credit sale");
    setSubmitting(true);
    try {
      const payload = {
        customer_id: tab.customer_id,
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
        .select("*, sale_items(*), customers(name)")
        .eq("id", data as string)
        .maybeSingle();
      setLastInvoice(sale);
      toast.success(`Sale ${sale?.invoice_no} recorded`);
      closeTab(active);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to complete sale");
    } finally {
      setSubmitting(false);
    }
  };

  // F2 add tab, F4 complete
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); addTab(); }
      if (e.key === "F4") { e.preventDefault(); handleSale(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col">
      {/* Tabs strip */}
      <div className="flex items-center gap-1 px-3 pt-2 border-b bg-card/40">
        <ScrollArea className="max-w-full">
          <div className="flex items-center gap-1 pb-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={`group flex items-center gap-2 rounded-t-md border border-b-0 px-3 py-1.5 text-sm whitespace-nowrap ${
                  t.id === active ? "bg-background border-border" : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                <span>{t.name}</span>
                {t.items.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5">{t.items.length}</Badge>
                )}
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
                  className="ml-1 rounded p-0.5 opacity-60 hover:opacity-100 hover:bg-destructive/20"
                >
                  <X className="h-3 w-3" />
                </span>
              </button>
            ))}
            <Button size="sm" variant="ghost" onClick={addTab} className="h-7 px-2">
              <Plus className="h-4 w-4" /> New (F2)
            </Button>
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {/* Billing window */}
        <div className="flex flex-col min-h-0 flex-1 bg-background">
          {/* Scan / search bar + customer + payment */}
          <div className="p-3 border-b grid grid-cols-1 md:grid-cols-[1fr_220px_160px_160px] gap-2 items-end">
            <div className="relative">
              <Label className="text-xs">Scan barcode / search item</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  autoFocus
                  placeholder="Scan barcode or type name / SKU…  (↑/↓ to choose, Enter to add)"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setSearch(""); return; }
                    if (e.key === "ArrowDown" && filtered.length) {
                      e.preventDefault();
                      setHighlight((h) => (h + 1) % filtered.length);
                      return;
                    }
                    if (e.key === "ArrowUp" && filtered.length) {
                      e.preventDefault();
                      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
                      return;
                    }
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const raw = search.trim();
                    // Empty search + items in cart → jump to Paid input
                    if (!raw) {
                      if (tab.items.length > 0) paidRef.current?.focus();
                      return;
                    }
                    const exact = productByBarcode[raw];
                    if (exact) { addProduct(exact); setSearch(""); return; }
                    if (filtered.length >= 1) {
                      const pick = filtered[Math.min(highlight, filtered.length - 1)] ?? filtered[0];
                      addProduct(pick);
                      setSearch("");
                    }
                  }}
                  className="pl-9 h-10"
                />
              </div>
              {search.trim() && filtered.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 rounded-md border bg-popover shadow-lg max-h-80 overflow-auto">
                  {filtered.map((p, i) => (
                    <button
                      key={p.id}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => { addProduct(p); setSearch(""); searchRef.current?.focus(); }}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 border-b last:border-0 ${
                        i === highlight ? "bg-accent" : "hover:bg-accent/60"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{p.name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {p.sku ?? "—"} · stock {fmtQty(p.stock)} {p.unit}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold text-sm text-primary">{fmtMoney(p.sell_price, sym)}</div>
                        <div className="text-[10px] text-muted-foreground">cost {fmtMoney(p.cost_price, sym)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {search.trim() && filtered.length === 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 rounded-md border bg-popover shadow-lg px-3 py-3 text-sm text-muted-foreground">
                  No products match "{search}".
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Customer</Label>
              <Select
                value={tab.customer_id ?? "walkin"}
                onValueChange={(v) => setTab({ customer_id: v === "walkin" ? null : v })}
              >
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
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
            <div>
              <Label className="text-xs">Payment</Label>
              <Select value={tab.payment_method} onValueChange={(v) => setTab({ payment_method: v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank">Bank transfer</SelectItem>
                  <SelectItem value="credit">Credit (later)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="text-right text-xs text-muted-foreground self-end pb-2">
              {tab.items.length} item{tab.items.length === 1 ? "" : "s"} · {tab.name}
            </div>
          </div>


          {/* Item-wise detailed table — FAST SALES style spreadsheet */}
          <div className="flex-1 min-h-0 overflow-auto bg-white dark:bg-background">
            <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b bg-muted/30 no-print">
              <Button
                size="sm"
                variant={showCost ? "secondary" : "ghost"}
                className="h-7 text-xs"
                onClick={() => setShowCost((v) => !v)}
              >
                {showCost ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                {showCost ? "Hide" : "Show"} Purchase Rate
              </Button>
            </div>
            <table className="w-full text-sm border-collapse [&_td]:border [&_th]:border [&_td]:border-border [&_th]:border-border">
              <thead className="sticky top-0 z-10 bg-[hsl(var(--muted))] text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="px-2 py-2 text-left w-14">Item No</th>
                  <th className="px-2 py-2 text-left">Item Name</th>
                  {showCost && (
                    <th className="px-2 py-2 text-right w-20 no-print" title="Purchase rate (internal)">P.Rate</th>
                  )}
                  <th className="px-2 py-2 text-right w-24">Unit Rate</th>
                  <th className="px-2 py-2 text-right w-20">QTY</th>
                  <th className="px-2 py-2 text-right w-24">Discount</th>
                  <th className="px-2 py-2 text-right w-28">Amount</th>
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
                  const profit = net - Number(it.qty) * Number(it.cost);
                  const zebra = idx % 2 === 0 ? "bg-amber-50/60 dark:bg-muted/20" : "bg-white dark:bg-background";
                  return (
                    <tr key={idx} className={`${zebra} hover:bg-amber-100/60 dark:hover:bg-muted/40`}>
                      <td className="px-2 py-1 font-mono text-xs">{it.code || String(idx + 1).padStart(3, "0")}</td>
                      <td className="px-2 py-1">
                        <div className="font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                          {it.name}
                        </div>
                      </td>

                      {showCost && (
                        <td className="px-2 py-1 text-right font-mono text-muted-foreground no-print">
                          {fmtMoney(it.cost, sym)}
                        </td>
                      )}
                      <td className="p-0">
                        <Input type="number" step="0.01" value={it.price}
                          onChange={(e) => updateLine(idx, { price: Number(e.target.value) })}
                          className="h-8 w-full text-right text-sm rounded-none border-0 focus-visible:ring-1" />
                      </td>
                      <td className="p-0">
                        <Input type="number" step="0.001" value={it.qty}
                          onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                          className="h-8 w-full text-right text-sm rounded-none border-0 focus-visible:ring-1" />
                      </td>
                      <td className="p-0">
                        <Input type="number" step="0.01" min={0} value={it.disc}
                          onChange={(e) => updateLine(idx, { disc: Math.max(0, Number(e.target.value)) })}
                          className="h-8 w-full text-right text-sm rounded-none border-0 focus-visible:ring-1" />
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
              </tbody>
            </table>
          </div>



          {/* Totals strip */}
          <div className="border-t bg-card grid grid-cols-1 md:grid-cols-[1fr_360px]">
            {/* Internal cost/profit + paid controls */}
            <div className="p-3 space-y-2 border-r">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Paid</Label>
                  <Input
                    ref={paidRef}
                    type="number"
                    step="0.01"
                    value={tab.paid}
                    onChange={(e) => setTab({ paid: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSale();
                      }
                    }}
                    placeholder={total.toFixed(2)}
                    className="h-9"
                  />
                </div>
                <div className="flex flex-col justify-end">
                  <button
                    onClick={() => setTab({ paid: total.toFixed(2) })}
                    className="text-xs text-primary hover:underline self-start"
                  >
                    Exact amount
                  </button>
                  <div className="text-xs mt-1">
                    {due > 0
                      ? <span className="text-destructive font-medium">Due: {fmtMoney(due, sym)}</span>
                      : <span className="text-success font-medium">Change: {fmtMoney(change, sym)}</span>}
                  </div>
                </div>
              </div>

              {/* Internal profit summary — screen only */}
              {tab.items.length > 0 && (() => {
                const cartCost = tab.items.reduce((s, i) => s + Number(i.qty) * Number(i.cost), 0);
                const cartProfit = subtotal - discount - cartCost;
                const net = subtotal - discount;
                const pct = net > 0 ? (cartProfit / net) * 100 : 0;
                return (
                  <div className="no-print rounded-md border border-dashed bg-muted/40 px-2 py-1.5 text-[11px] flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Cost <span className="font-mono text-foreground/80">{fmtMoney(cartCost, sym)}</span>
                    </span>
                    <span className={`font-semibold ${cartProfit >= 0 ? "text-success" : "text-destructive"}`}>
                      Profit {fmtMoney(cartProfit, sym)} ({pct.toFixed(1)}%)
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Money column */}
            <div className="p-3 space-y-1.5 bg-muted/30">
              <Row label="Gross" value={fmtMoney(subtotal + lineDiscountTotal, sym)} muted />
              {lineDiscountTotal > 0 && (
                <Row label="Line discounts" value={`- ${fmtMoney(lineDiscountTotal, sym)}`} muted />
              )}
              <Row label="Subtotal" value={fmtMoney(subtotal, sym)} />

              <div className="flex items-center justify-between text-sm gap-2">
                <span className="text-muted-foreground">Discount</span>
                <div className="flex items-center gap-1">
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

              <Button className="w-full h-11 mt-2" onClick={handleSale} disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Complete sale (F4)
              </Button>
            </div>
          </div>
        </div>
      </div>


      <InvoiceDialog invoice={lastInvoice} sym={sym} settings={settings} onClose={() => setLastInvoice(null)} />
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

