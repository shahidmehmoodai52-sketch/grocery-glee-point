import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Search, Trash2, Printer, ShoppingCart, Loader2 } from "lucide-react";
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
  price: number;
  cost: number;
  disc: number;
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
  const [submitting, setSubmitting] = useState(false);

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
    if (!q) return products.slice(0, 24);
    return products
      .filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q),
      )
      .slice(0, 60);
  }, [products, search]);

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
      cost: Number(p.cost_price),
      disc: 0,
    });
    setTab({ items });
  };

  const updateLine = (idx: number, patch: Partial<CartItem>) => {
    const items = tab.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    setTab({ items });
  };

  const removeLine = (idx: number) => setTab({ items: tab.items.filter((_, i) => i !== idx) });

  const subtotal = tab.items.reduce(
    (s, i) => s + Math.max(Number(i.qty) * Number(i.price) - Number(i.disc || 0), 0),
    0,
  );
  const lineDiscountTotal = tab.items.reduce((s, i) => s + Number(i.disc || 0), 0);
  const tax = +(subtotal * (taxRate / 100)).toFixed(2);
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
        discount,
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

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_440px] min-h-0">
        {/* Products */}
        <div className="flex flex-col min-h-0 border-r">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Scan barcode or search products…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filtered.length === 1) {
                    addProduct(filtered[0]);
                    setSearch("");
                  }
                }}
                className="pl-9"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 p-3">
              {filtered.map((p) => {
                const margin = Number(p.sell_price) - Number(p.cost_price);
                const mpct = Number(p.sell_price) > 0 ? (margin / Number(p.sell_price)) * 100 : 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => addProduct(p)}
                    className="text-left p-3 rounded-lg border bg-card hover:border-primary hover:shadow-sm transition"
                  >
                    <div className="font-medium text-sm line-clamp-2">{p.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{p.sku ?? "—"}</div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="font-semibold text-primary">{fmtMoney(p.sell_price, sym)}</span>
                      <Badge variant={p.stock > 0 ? "outline" : "destructive"} className="text-[10px]">
                        {fmtQty(p.stock)} {p.unit}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground border-t pt-1.5">
                      <span>Cost <span className="font-mono text-foreground/70">{fmtMoney(p.cost_price, sym)}</span></span>
                      <span className={margin >= 0 ? "text-success" : "text-destructive"}>
                        +{fmtMoney(margin, sym)} ({mpct.toFixed(0)}%)
                      </span>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="col-span-full text-center text-sm text-muted-foreground py-12">
                  No products match. Add products from the Products page.
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Cart panel */}
        <div className="flex flex-col min-h-0 bg-card/30">
          <div className="p-3 border-b">
            <Label className="text-xs">Customer</Label>
            <Select
              value={tab.customer_id ?? "walkin"}
              onValueChange={(v) => setTab({ customer_id: v === "walkin" ? null : v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
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

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {tab.items.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-12">
                  Add items by clicking products or scanning barcodes.
                </div>
              )}
              {tab.items.map((it, idx) => {
                const lineRev = Number(it.qty) * Number(it.price);
                const lineCost = Number(it.qty) * Number(it.cost);
                const lineProfit = lineRev - lineCost;
                const mpct = Number(it.price) > 0 ? ((Number(it.price) - Number(it.cost)) / Number(it.price)) * 100 : 0;
                return (
                  <Card key={idx} className="p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{it.name}</div>
                        <div className="flex items-center gap-1 mt-1">
                          <Input
                            type="number"
                            step="0.001"
                            value={it.qty}
                            onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                            className="h-8 w-20 text-sm"
                          />
                          <span className="text-xs text-muted-foreground">×</span>
                          <Input
                            type="number"
                            step="0.01"
                            value={it.price}
                            onChange={(e) => updateLine(idx, { price: Number(e.target.value) })}
                            className="h-8 w-24 text-sm"
                          />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-sm">{fmtMoney(lineRev, sym)}</div>
                        <Button size="icon" variant="ghost" className="h-7 w-7 mt-1" onClick={() => removeLine(idx)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    {/* Internal cost / margin — screen only, never printed */}
                    <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-muted-foreground border-t pt-1">
                      <span title="Purchase rate (cost)">
                        Cost <span className="font-mono text-foreground/70">{fmtMoney(it.cost, sym)}</span>
                        <span className="mx-1 opacity-50">·</span>
                        Sale <span className="font-mono text-foreground/70">{fmtMoney(it.price, sym)}</span>
                      </span>
                      <span className={lineProfit >= 0 ? "text-success" : "text-destructive"} title="Line profit">
                        +{fmtMoney(lineProfit, sym)} ({mpct.toFixed(0)}%)
                      </span>
                    </div>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>

          <div className="border-t p-3 space-y-2 bg-card">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">{fmtMoney(subtotal, sym)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Discount</span>
              <Input
                type="number"
                step="0.01"
                value={tab.discount}
                onChange={(e) => setTab({ discount: Number(e.target.value) })}
                className="h-7 w-24 text-right text-sm"
              />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tax ({taxRate}%)</span>
              <span>{fmtMoney(tax, sym)}</span>
            </div>
            <div className="flex justify-between text-lg font-semibold border-t pt-2">
              <span>Total</span>
              <span className="text-primary">{fmtMoney(total, sym)}</span>
            </div>
            {/* Internal profit summary — screen only, never printed */}
            {tab.items.length > 0 && (() => {
              const cartCost = tab.items.reduce((s, i) => s + Number(i.qty) * Number(i.cost), 0);
              const cartProfit = subtotal - discount - cartCost;
              const pct = subtotal > 0 ? (cartProfit / (subtotal - discount || 1)) * 100 : 0;
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

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <Label className="text-xs">Method</Label>
                <Select value={tab.payment_method} onValueChange={(v) => setTab({ payment_method: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="bank">Bank transfer</SelectItem>
                    <SelectItem value="credit">Credit (later)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Paid</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={tab.paid}
                  onChange={(e) => setTab({ paid: e.target.value })}
                  placeholder={total.toFixed(2)}
                  className="h-9"
                />
              </div>
            </div>
            <div className="flex justify-between text-xs pt-1">
              <span className="text-muted-foreground">
                {due > 0 ? `Due: ${fmtMoney(due, sym)}` : `Change: ${fmtMoney(change, sym)}`}
              </span>
              <button
                onClick={() => setTab({ paid: total.toFixed(2) })}
                className="text-primary hover:underline"
              >
                Exact
              </button>
            </div>

            <Button className="w-full h-11 mt-2" onClick={handleSale} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Complete sale (F4)
            </Button>
          </div>
        </div>
      </div>

      <InvoiceDialog invoice={lastInvoice} sym={sym} settings={settings} onClose={() => setLastInvoice(null)} />
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

