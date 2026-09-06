import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { roundToTillixQty } from "@/lib/quantity-rounding";
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
  const { t } = useTranslation();
  const refundMethodLabel = (m: string) =>
    m === "cash" ? t('purchase_returns.method_cash', 'Cash')
      : m === "card" ? t('sale_returns.method_card', 'Card')
      : m === "transfer" ? t('purchase_returns.method_transfer', 'Transfer')
      : m === "credit" ? t('sale_returns.method_credit', 'Store credit')
      : m === "staff" ? t('sale_returns.expense_ledger_badge', 'Expense ledger')
      : m;
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";

  const [open, setOpen] = useState(false);
  const [saleId, setSaleId] = useState<string>("none");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [partyType, setPartyType] = useState<"customer" | "staff">("customer");
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
          await fetchAllRows<any>((from: number, to: number) =>
            supabase
              .from("sale_returns")
              .select("*, customers(name), expense_persons(name), sale_return_items(*)")
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
          await fetchAllRows<any>((from: number, to: number) =>
            supabase
              .from("sales")
              .select(
                "id,invoice_no,customer_id,expense_person_id,total,created_at,customers(name),expense_persons(name),sale_items(*)",
              )
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
    const base =
      partyType === "staff"
        ? (sales as any[]).filter((s) => s.expense_person_id)
        : (sales as any[]);
    if (!q) return base;
    return base.filter(
      (s) =>
        String(s.invoice_no ?? "")
          .toLowerCase()
          .includes(q) ||
        String(s.customers?.name ?? s.expense_persons?.name ?? "")
          .toLowerCase()
          .includes(q) ||
        String(Number(s.total).toFixed(2)).includes(q),
    );
  }, [sales, invoiceSearch, partyType]);

  const setItem = (i: number, patch: Partial<ItemRow>) =>
    setItems((ls) =>
      ls.map((l, idx) =>
        idx === i ? { ...l, ...patch, qty: "qty" in patch ? roundToTillixQty(Number(patch.qty)) : l.qty } : l,
      ),
    );

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
    toast.success(t('sale_returns.product_added_toast', '{{name}} added', { name: p.name }));
  };

  const reset = () => {
    setOpen(false);
    setItems([]);
    setSaleId("none");
    setInvoiceSearch("");
    setPartyType("customer");
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
    if (!picked.length) return toast.error(t('sale_returns.select_at_least_one_item', 'Select at least one item to return'));
    for (const l of picked) {
      if (l.max != null && l.qty > l.max) {
        return toast.error(t('sale_returns.qty_exceeds_sold', '{{name}}: return qty {{qty}} exceeds sold qty {{max}}', { name: l.name, qty: l.qty, max: l.max }));
      }
    }
    if (partyType === "staff" && !selectedSale?.expense_person_id) {
      return toast.error(t('sale_returns.pick_staff_invoice', "Pick the staff member's purchase invoice to return"));
    }
    if (partyType === "customer" && refund > total + 0.001) {
      return toast.error(t('purchase_returns.refund_exceeds_total', 'Refund cannot exceed total'));
    }
    let offline = false;
    let localRet: any = null;
    try {
      const res = await completeSaleReturnOfflineAware(
        {
          sale_id: saleId === "none" ? null : saleId,
          customer_id: partyType === "customer" && customer !== "none" ? customer : null,
          party_type: partyType,
          expense_person_id: partyType === "staff" ? (selectedSale?.expense_person_id ?? null) : null,
          expense_person_name: partyType === "staff" ? (selectedSale?.expense_persons?.name ?? null) : null,
          tax,
          // Staff returns never pay cash out — the RPC shrinks the linked
          // "staff_purchase" expense row instead.
          refund_amount: partyType === "staff" ? 0 : refund,
          refund_method: partyType === "staff" ? "staff" : method,
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
      return toast.error(e?.message ?? t('sale_returns.could_not_record_return', 'Could not record return'));
    }
    toast.success(
      offline
        ? t('sale_returns.return_saved_offline', 'Return saved offline — will sync automatically')
        : t('sale_returns.return_recorded', 'Sale return recorded, stock restored'),
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

  // Stable reference: Receipt's print-sizing effect depends on `invoice`, so
  // rebuilding this object inline on every render (as it was before) reran
  // that effect on every unrelated re-render of this page while the dialog
  // was open, instead of only when the viewed return actually changes.
  const viewingInvoice = useMemo(
    () => (viewing ? { ...viewing, sale_items: viewing.sale_return_items } : null),
    [viewing],
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('sale_returns.title', 'Sale Returns')}</h1>
          <p className="text-sm text-muted-foreground">{t('sale_returns.subtitle', 'Refund customers and restore stock')}</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              {t('sale_returns.new_return', 'New return')}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('sale_returns.dialog_title', 'New sale return')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {/* Step 1: pick invoice */}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <Label>{t('sale_returns.return_for_label', 'Return for')}</Label>
                  <div className="flex gap-2 mt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={partyType === "customer" ? "default" : "outline"}
                      onClick={() => {
                        setPartyType("customer");
                        setSaleId("none");
                      }}
                    >
                      {t('sale_returns.walking_customer', 'Walking customer')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={partyType === "staff" ? "default" : "outline"}
                      onClick={() => {
                        setPartyType("staff");
                        setSaleId("none");
                      }}
                    >
                      {t('expenses.role_staff', 'Staff')}
                    </Button>
                  </div>
                  {partyType === "staff" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('sale_returns.staff_note', "Pick the staff member's own purchase invoice below — no cash is paid out, the return instead reduces what that invoice added to their expense ledger.")}
                    </p>
                  )}
                </div>

                <div>
                  <Label>{t('sale_returns.search_invoice_label', 'Search invoice')}</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={invoiceSearch}
                      onChange={(e) => setInvoiceSearch(e.target.value)}
                      placeholder={t('sale_returns.search_invoice_placeholder2', 'Invoice #, name, amount…')}
                      className="pl-8"
                    />
                  </div>
                  <div className="mt-2 max-h-40 overflow-y-auto border rounded-md">
                    {partyType === "customer" && (
                      <button
                        type="button"
                        onClick={() => setSaleId("none")}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${saleId === "none" ? "bg-accent" : ""}`}
                      >
                        {t('sale_returns.adhoc_no_invoice', '— Ad-hoc return (no invoice) —')}
                      </button>
                    )}
                    {filteredSales.slice(0, 50).map((s: any) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSaleId(s.id)}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex justify-between ${saleId === s.id ? "bg-accent font-medium" : ""}`}
                      >
                        <span className="font-mono">{s.invoice_no}</span>
                        <span className="text-muted-foreground truncate mx-2">
                          {s.customers?.name ?? s.expense_persons?.name ?? t('common.walk_in', 'Walk-in')}
                        </span>
                        <span>{fmtMoney(s.total, sym)}</span>
                      </button>
                    ))}
                    {filteredSales.length === 0 && (
                      <div className="text-center text-xs text-muted-foreground py-3">
                        {partyType === "staff"
                          ? t('sale_returns.no_staff_invoices', 'No staff purchase invoices found')
                          : t('sale_returns.no_invoices_found', 'No invoices found')}
                      </div>
                    )}
                  </div>
                </div>

                {selectedSale && (
                  <div className="text-xs bg-muted/40 rounded p-2">
                    {t('sales.th_invoice', 'Invoice')} <span className="font-mono">{selectedSale.invoice_no}</span> ·{" "}
                    {new Date(selectedSale.created_at).toLocaleString()} · {t('sales.th_total', 'Total')}{" "}
                    {fmtMoney(selectedSale.total, sym)} ·{" "}
                    {selectedSale.customers?.name ?? selectedSale.expense_persons?.name ?? t('common.walk_in', 'Walk-in')}
                  </div>
                )}

                {partyType === "customer" && saleId === "none" && (
                  <div>
                    <Label>{t('pos.customer', 'Customer')}</Label>
                    <Select value={customer} onValueChange={setCustomer}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('common.walk_in', 'Walk-in')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('purchase_returns.walk_in_option', '— Walk-in —')}</SelectItem>
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
                <Label>{t('sale_returns.search_item_label', 'Search item to return')}</Label>
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
                    placeholder={t('sale_returns.item_search_placeholder', 'Item name, code or barcode…')}
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
                        {t('sale_returns.no_items_found', 'No items found')}
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
                      <TableHead>{t('customers.th_item', 'Item')}</TableHead>
                      <TableHead className="w-28">{t('sale_returns.th_return_qty', 'Return qty')}</TableHead>
                      <TableHead className="w-28">{t('products.price_label', 'Price')}</TableHead>
                      <TableHead className="text-right w-28">{t('sale_returns.th_line_total', 'Line total')}</TableHead>
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
                            ? t('sale_returns.add_items_below', 'Add items below')
                            : t('sale_returns.pick_invoice_to_load', 'Pick an invoice to load its items')}
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
                              <div className="text-xs text-muted-foreground">{t('sale_returns.sold_label', 'sold: {{qty}}', { qty: l.max })}</div>
                            </div>
                          ) : (
                            <Input
                              value={l.name}
                              onChange={(e) => setItem(i, { name: e.target.value })}
                              className="h-8"
                              placeholder={t('sale_returns.item_name_placeholder', 'Item name')}
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
                    {t('sale_returns.add_adhoc_item', 'Add ad-hoc item')}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <Label>{t('purchase_returns.tax', 'Tax')}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={tax || ""}
                    onChange={(e) => setTax(Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label>{t('sales.th_refund', 'Refund')}</Label>
                  {partyType === "staff" ? (
                    <div className="h-9 flex items-center text-sm text-muted-foreground">
                      {fmtMoney(0, sym)} {t('sale_returns.expense_ledger_suffix', '(expense ledger)')}
                    </div>
                  ) : (
                    <Input
                      type="number"
                      step="0.01"
                      value={refund || ""}
                      onChange={(e) => setRefund(Number(e.target.value))}
                    />
                  )}
                </div>
                <div>
                  <Label>{t('sales.th_method', 'Method')}</Label>
                  {partyType === "staff" ? (
                    <div className="h-9 flex items-center">
                      <Badge variant="outline">{t('sale_returns.expense_ledger_badge', 'Expense ledger')}</Badge>
                    </div>
                  ) : (
                    <Select value={method} onValueChange={setMethod}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">{t('purchase_returns.method_cash', 'Cash')}</SelectItem>
                        <SelectItem value="card">{t('sale_returns.method_card', 'Card')}</SelectItem>
                        <SelectItem value="transfer">{t('purchase_returns.method_transfer', 'Transfer')}</SelectItem>
                        <SelectItem value="credit">{t('sale_returns.method_credit', 'Store credit')}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="flex flex-col justify-end">
                  <div className="text-sm text-muted-foreground">
                    {partyType === "staff" ? t('sale_returns.reduces_expense_by', 'Reduces expense ledger by') : t('sales.th_total', 'Total')}
                  </div>
                  <div className="text-2xl font-semibold text-primary">{fmtMoney(total, sym)}</div>
                </div>
              </div>
              <div>
                <Label>{t('common.note', 'Note')}</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button onClick={submit}>
                <Undo2 className="h-4 w-4 mr-2" />
                {t('sale_returns.process_return', 'Process return')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('purchase_returns.th_return_no', 'Return #')}</TableHead>
              <TableHead>{t('sales.th_date', 'Date')}</TableHead>
              <TableHead>{t('sales.th_customer', 'Customer')}</TableHead>
              <TableHead className="text-right">{t('sales.th_total', 'Total')}</TableHead>
              <TableHead className="text-right">{t('sales.th_refund', 'Refund')}</TableHead>
              <TableHead>{t('sales.th_method', 'Method')}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {returns.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                  {t('sale_returns.no_returns_yet', 'No returns yet')}
                </TableCell>
              </TableRow>
            )}
            {returns.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.return_no}</TableCell>
                <TableCell className="text-sm">{new Date(r.created_at).toLocaleString()}</TableCell>
                <TableCell>
                  {r.party_type === "staff" ? (
                    <span className="inline-flex items-center gap-1">
                      <Badge variant="secondary" className="text-[10px]">{t('expenses.role_staff', 'Staff')}</Badge>
                      {r.expense_persons?.name ?? "—"}
                    </span>
                  ) : (
                    r.customers?.name ?? t('common.walk_in', 'Walk-in')
                  )}
                </TableCell>
                <TableCell className="text-right font-medium">{fmtMoney(r.total, sym)}</TableCell>
                <TableCell className="text-right">{fmtMoney(r.refund_amount, sym)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {refundMethodLabel(r.refund_method)}
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
            <DialogTitle>{t('sales.return_title', 'Return {{no}}', { no: viewing?.return_no })}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="bg-muted/30 rounded p-3 max-h-[70vh] overflow-auto">
              <div className="print-area">
                <Receipt
                  kind="sale-return"
                  invoice={viewingInvoice}
                  settings={settings}
                />
              </div>
            </div>
          )}
          <DialogFooter className="no-print">
            <Button onClick={() => printReceipt()}>
              <Printer className="h-4 w-4 mr-2" />
              {t('common.print', 'Print')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
