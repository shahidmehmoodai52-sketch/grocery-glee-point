import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Eye, Printer, Undo2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { Receipt, printReceipt } from "@/components/receipt";
import { searchProductsLocal } from "@/lib/offline/pos";
import { readLocalFirst } from "@/lib/offline/data-access";
import { db as offlineDb } from "@/lib/offline/db";
import { completeSaleReturnOfflineAware } from "@/lib/offline/returns";
import { fetchAll as fetchAllRows } from "@/lib/supabase-page";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const Route = createFileRoute("/_authenticated/sale-returns")({ component: Page });

type ItemRow = {
  product_id: string | null;
  name: string;
  qty: number; // return qty
  price: number;
  max?: number; // original sold qty (when from an invoice)
  selected: boolean;
};

async function enrichReturnRow(row: any) {
  if (!row.sale_return_items) {
    try {
      row.sale_return_items = await offlineDb()
        .sale_return_items.where("return_id")
        .equals(row.id)
        .toArray();
    } catch (error) {
      void error;
      row.sale_return_items = [];
    }
  }
  if (!row.customers && row.customer_id) {
    try {
      const c = await offlineDb().customers.get(row.customer_id);
      if (c) row.customers = { name: c.name };
    } catch {
      // ignore
    }
  }
  return row;
}

async function enrichSaleRow(row: any) {
  if (!row.sale_items) {
    try {
      row.sale_items = await offlineDb().sale_items.where("sale_id").equals(row.id).toArray();
    } catch (error) {
      void error;
      row.sale_items = [];
    }
  }
  if (!row.customers && row.customer_id) {
    try {
      const c = await offlineDb().customers.get(row.customer_id);
      if (c) row.customers = { name: c.name };
    } catch {
      // ignore
    }
  }
  return row;
}

function Page() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";

  const [open, setOpen] = useState(false);
  const [saleId, setSaleId] = useState<string>("none");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [customer, setCustomer] = useState<string>("none");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [tax, setTax] = useState(0);
  const [refund, setRefund] = useState(0);
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [viewing, setViewing] = useState<any>(null);

  const today = new Date().toISOString().slice(0, 10);
  const { data: returns = [] } = useQuery({
    queryKey: ["sale-returns"],
    queryFn: () =>
      readLocalFirst<any[]>({
        table: "sale_returns",
        cloud: async () =>
          await fetchAllRows<any>((from, to) =>
            supabase
              .from("sale_returns")
              .select("*, customers(name), sale_return_items(*)")
              .order("created_at", { ascending: false })
              .range(from, to),
          ),
        local: async () => {
          const rows = await offlineDb().sale_returns.orderBy("created_at").reverse().toArray();
          return await Promise.all(rows.map(enrichReturnRow));
        },
        cache: async (rows) => {
          try {
            await offlineDb().sale_returns.bulkPut(rows as any[]);
            const items = (rows as any[]).flatMap((r) => r.sale_return_items ?? []);
            if (items.length) await offlineDb().sale_return_items.bulkPut(items);
          } catch (error) {
            void error;
          }
        },
      }),
  });
  const { data: sales = [] } = useQuery({
    queryKey: ["sales-for-return"],
    queryFn: () =>
      readLocalFirst<any[]>({
        table: "sales",
        cloud: async () =>
          await fetchAllRows<any>((from, to) =>
            supabase
              .from("sales")
              .select("id,invoice_no,customer_id,total,created_at,customers(name),sale_items(*)")
              .order("created_at", { ascending: false })
              .range(from, to),
          ),
        local: async () => {
          const rows = await offlineDb().sales.orderBy("created_at").reverse().toArray();
          return await Promise.all(rows.map(enrichSaleRow));
        },
        cache: async (rows) => {
          try {
            await offlineDb().sales.bulkPut(rows as any[]);
            const items = (rows as any[]).flatMap((r) => r.sale_items ?? []);
            if (items.length) await offlineDb().sale_items.bulkPut(items);
          } catch (error) {
            void error;
          }
        },
      }),
  });
  const [date, setDate] = useState(today);
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () =>
      readLocalFirst<any[]>({
        table: "customers",
        cloud: async () =>
          (await supabase.from("customers").select("id,name").order("name")).data ?? [],
        local: async () => (await offlineDb().customers.orderBy("name").toArray()) as any[],
        cache: async (rows) => {
          try {
            await offlineDb().customers.bulkPut(rows as any[]);
          } catch {}
        },
      }),
  });

  // Item-wise product search (works offline via the local mirror)
  const [debouncedProductSearch, setDebouncedProductSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedProductSearch(productSearch.trim()), 200);
    return () => clearTimeout(t);
  }, [productSearch]);
  const { data: productResults = [] } = useQuery({
    queryKey: ["sale-return-product-search", debouncedProductSearch],
    enabled: debouncedProductSearch.length > 0,
    queryFn: async () => {
      const q = debouncedProductSearch;
      const like = `%${q}%`;
      try {
        const [nameRes, skuRes, barcodeRes] = await Promise.all([
          supabase
            .from("products")
            .select("id,name,sku,barcode,sell_price,stock,unit")
            .eq("is_active", true)
            .ilike("name", like)
            .order("name")
            .limit(30),
          supabase
            .from("products")
            .select("id,name,sku,barcode,sell_price,stock,unit")
            .eq("is_active", true)
            .ilike("sku", like)
            .limit(15),
          supabase
            .from("products")
            .select("id,name,sku,barcode,sell_price,stock,unit")
            .eq("is_active", true)
            .ilike("barcode", like)
            .limit(15),
        ]);
        const err = nameRes.error ?? skuRes.error ?? barcodeRes.error;
        if (err) throw err;
        const map = new Map<string, any>();
        for (const r of [
          ...(skuRes.data ?? []),
          ...(barcodeRes.data ?? []),
          ...(nameRes.data ?? []),
        ])
          map.set(r.id, r);
        return [...map.values()].slice(0, 30);
      } catch {
        return (await searchProductsLocal(q, 30)) as any[];
      }
    },
  });

  // Load items from selected invoice — pre-checked, editable qty capped at sold qty
  useEffect(() => {
    if (saleId === "none") {
      setItems([]);
      return;
    }
    const s = sales.find((x: any) => x.id === saleId);
    if (!s) return;
    setCustomer(s.customer_id ?? "none");
    setItems(
      (s.sale_items ?? []).map((it: any) => ({
        product_id: it.product_id,
        name: it.name,
        qty: Number(it.qty),
        price: Number(it.price),
        max: Number(it.qty),
        selected: true,
      })),
    );
  }, [saleId, sales]);

  // Auto-refund the full selected total when items/tax change
  const subtotal = useMemo(
    () => items.filter((l) => l.selected).reduce((s, l) => s + l.qty * l.price, 0),
    [items],
  );
  const total = subtotal + Number(tax || 0);
  useEffect(() => {
    setRefund(+total.toFixed(2));
  }, [total]);

  const filteredSales = useMemo(() => {
    const q = invoiceSearch.trim().toLowerCase();
    if (!q) return sales as any[];
    return (sales as any[]).filter(
      (s) =>
        String(s.invoice_no ?? "")
          .toLowerCase()
          .includes(q) ||
        String(s.customers?.name ?? "")
          .toLowerCase()
          .includes(q) ||
        String(Number(s.total).toFixed(2)).includes(q),
    );
  }, [sales, invoiceSearch]);

  const setItem = (i: number, patch: Partial<ItemRow>) =>
    setItems((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const addAdhoc = () =>
    setItems((l) => [...l, { product_id: null, name: "", qty: 1, price: 0, selected: true }]);

  const addProduct = (p: any) => {
    setItems((ls) => {
      const idx = ls.findIndex((l) => l.product_id === p.id && l.max == null);
      if (idx >= 0)
        return ls.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1, selected: true } : l));
      return [
        ...ls,
        {
          product_id: p.id,
          name: p.name,
          qty: 1,
          price: Number(p.sell_price ?? 0),
          selected: true,
        },
      ];
    });
    setProductSearch("");
    toast.success(`${p.name} added`);
  };

  const reset = () => {
    setOpen(false);
    setItems([]);
    setSaleId("none");
    setInvoiceSearch("");
    setCustomer("none");
    setTax(0);
    setRefund(0);
    setMethod("cash");
    setNote("");
    setDate(today);
    setProductSearch("");
  };

  const submit = async () => {
    const picked = items.filter((l) => l.selected && l.name && l.qty > 0);
    if (!picked.length) return toast.error("Select at least one item to return");
    for (const l of picked) {
      if (l.max != null && l.qty > l.max) {
        return toast.error(`${l.name}: return qty ${l.qty} exceeds sold qty ${l.max}`);
      }
    }
    if (refund > total + 0.001) return toast.error("Refund cannot exceed total");
    let offline = false;
    let localRet: any = null;
    try {
      const res = await completeSaleReturnOfflineAware(
        {
          sale_id: saleId === "none" ? null : saleId,
          customer_id: customer === "none" ? null : customer,
          tax,
          refund_amount: refund,
          refund_method: method,
          note,
          items: picked.map((l) => ({
            product_id: l.product_id,
            name: l.name,
            qty: l.qty,
            price: l.price,
          })),
        },
        { original_invoice_no: selectedSale?.invoice_no ?? null },
      );
      offline = res.offline;
      localRet = res.ret;
    } catch (e: any) {
      return toast.error(e?.message ?? "Could not record return");
    }
    toast.success(
      offline
        ? "Return saved offline — will sync automatically"
        : "Sale return recorded, stock restored",
    );
    reset();
    // Offline the cloud row doesn't exist yet — open the local record so the
    // cashier can still print the return receipt.
    if (offline && localRet) setViewing(localRet);

    qc.invalidateQueries({ queryKey: ["sale-returns"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
    qc.invalidateQueries({ queryKey: ["report-sales-full"] });
    qc.invalidateQueries({ queryKey: ["report-sale-returns"] });
    qc.invalidateQueries({ queryKey: ["dash-sale-returns"] });
  };

  const selectedSale = saleId !== "none" ? (sales as any[]).find((s) => s.id === saleId) : null;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sale Returns</h1>
          <p className="text-sm text-muted-foreground">Refund customers and restore stock</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New return
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New sale return</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {/* Step 1: pick invoice */}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <Label>Search invoice</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={invoiceSearch}
                      onChange={(e) => setInvoiceSearch(e.target.value)}
                      placeholder="Invoice #, customer, amount…"
                      className="pl-8"
                    />
                  </div>
                  <div className="mt-2 max-h-40 overflow-y-auto border rounded-md">
                    <button
                      type="button"
                      onClick={() => setSaleId("none")}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${saleId === "none" ? "bg-accent" : ""}`}
                    >
                      — Ad-hoc return (no invoice) —
                    </button>
                    {filteredSales.slice(0, 50).map((s: any) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSaleId(s.id)}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex justify-between ${saleId === s.id ? "bg-accent font-medium" : ""}`}
                      >
                        <span className="font-mono">{s.invoice_no}</span>
                        <span className="text-muted-foreground truncate mx-2">
                          {s.customers?.name ?? "Walk-in"}
                        </span>
                        <span>{fmtMoney(s.total, sym)}</span>
                      </button>
                    ))}
                    {filteredSales.length === 0 && (
                      <div className="text-center text-xs text-muted-foreground py-3">
                        No invoices found
                      </div>
                    )}
                  </div>
                </div>

                {selectedSale && (
                  <div className="text-xs bg-muted/40 rounded p-2">
                    Invoice <span className="font-mono">{selectedSale.invoice_no}</span> ·{" "}
                    {new Date(selectedSale.created_at).toLocaleString()} · Total{" "}
                    {fmtMoney(selectedSale.total, sym)} ·{" "}
                    {selectedSale.customers?.name ?? "Walk-in"}
                  </div>
                )}

                {saleId === "none" && (
                  <div>
                    <Label>Customer</Label>
                    <Select value={customer} onValueChange={setCustomer}>
                      <SelectTrigger>
                        <SelectValue placeholder="Walk-in" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Walk-in —</SelectItem>
                        {customers.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Step 2: search a product and add it item-wise */}
              <div>
                <Label>Search item to return</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && productResults.length) {
                        e.preventDefault();
                        addProduct(productResults[0]);
                      }
                    }}
                    placeholder="Item name, code or barcode…"
                    className="pl-8"
                  />
                </div>
                {productSearch.trim() !== "" && (
                  <div className="mt-2 max-h-44 overflow-y-auto border rounded-md">
                    {productResults.map((p: any) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addProduct(p)}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex justify-between gap-2"
                      >
                        <span className="truncate">{p.name}</span>
                        <span className="text-xs text-muted-foreground font-mono shrink-0">
                          {p.sku ?? p.barcode ?? ""}
                        </span>
                        <span className="shrink-0">{fmtMoney(p.sell_price ?? 0, sym)}</span>
                      </button>
                    ))}
                    {productResults.length === 0 && (
                      <div className="text-center text-xs text-muted-foreground py-3">
                        No items found
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Step 3: pick items */}
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="w-28">Return qty</TableHead>
                      <TableHead className="w-28">Price</TableHead>
                      <TableHead className="text-right w-28">Line total</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center text-muted-foreground py-4 text-sm"
                        >
                          {saleId === "none"
                            ? "Add items below"
                            : "Pick an invoice to load its items"}
                        </TableCell>
                      </TableRow>
                    )}
                    {items.map((l, i) => (
                      <TableRow key={i} className={!l.selected ? "opacity-50" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={l.selected}
                            onCheckedChange={(v) => setItem(i, { selected: !!v })}
                          />
                        </TableCell>
                        <TableCell>
                          {l.max != null ? (
                            <div>
                              <div className="text-sm">{l.name}</div>
                              <div className="text-xs text-muted-foreground">sold: {l.max}</div>
                            </div>
                          ) : (
                            <Input
                              value={l.name}
                              onChange={(e) => setItem(i, { name: e.target.value })}
                              className="h-8"
                              placeholder="Item name"
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.001"
                            min={0}
                            max={l.max}
                            value={l.qty}
                            onChange={(e) => setItem(i, { qty: Number(e.target.value) })}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={l.price}
                            onChange={(e) => setItem(i, { price: Number(e.target.value) })}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {fmtMoney(l.qty * l.price, sym)}
                        </TableCell>
                        <TableCell>
                          {l.max == null && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setItems(items.filter((_, x) => x !== i))}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="p-2">
                  <Button variant="outline" size="sm" onClick={addAdhoc}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add ad-hoc item
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <Label>Tax</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={tax || ""}
                    onChange={(e) => setTax(Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label>Refund</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={refund || ""}
                    onChange={(e) => setRefund(Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label>Method</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="transfer">Transfer</SelectItem>
                      <SelectItem value="credit">Store credit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col justify-end">
                  <div className="text-sm text-muted-foreground">Total</div>
                  <div className="text-2xl font-semibold text-primary">{fmtMoney(total, sym)}</div>
                </div>
              </div>
              <div>
                <Label>Note</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Cancel
              </Button>
              <Button onClick={submit}>
                <Undo2 className="h-4 w-4 mr-2" />
                Process return
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Return #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Refund</TableHead>
              <TableHead>Method</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {returns.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                  No returns yet
                </TableCell>
              </TableRow>
            )}
            {returns.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.return_no}</TableCell>
                <TableCell className="text-sm">{new Date(r.created_at).toLocaleString()}</TableCell>
                <TableCell>{r.customers?.name ?? "Walk-in"}</TableCell>
                <TableCell className="text-right font-medium">{fmtMoney(r.total, sym)}</TableCell>
                <TableCell className="text-right">{fmtMoney(r.refund_amount, sym)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {r.refund_method}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setViewing(r)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Return {viewing?.return_no}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="bg-muted/30 rounded p-3 max-h-[70vh] overflow-auto">
              <div className="print-area">
                <Receipt
                  kind="sale-return"
                  invoice={{ ...viewing, sale_items: viewing.sale_return_items }}
                  settings={settings}
                />
              </div>
            </div>
          )}
          <DialogFooter className="no-print">
            <Button onClick={() => printReceipt()}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
