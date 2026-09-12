import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Printer, TrendingUp, TrendingDown, Wallet, Eye, CalendarIcon, Package, Search, ArrowUpDown, CreditCard } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { printDocument } from "@/components/receipt";
import { cn } from "@/lib/utils";
import { PRESETS, rangeFor, type DatePreset } from "@/lib/date-presets";
import { useEarliestDataDate } from "@/lib/earliest-date";
import { NeedsInternetBanner } from "@/components/needs-internet-banner";
import { fetchAll } from "@/lib/supabase-page";
import { useBusinessType } from "@/hooks/use-tenant";


export const Route = createFileRoute("/_authenticated/reports")({ component: Page });

function SupplierWiseReport({
  sales,
  saleReturns,
  currencySymbol,
  onDrill,
  search,
}: {
  sales: any[];
  saleReturns: any[];
  currencySymbol: string;
  onDrill: (drill: any) => void;
  search: string;
}) {
  const { t } = useTranslation();
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"qty" | "revenue">("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: suppliers = [] } = useQuery({
    queryKey: ["report-suppliers"],
    queryFn: async () => await fetchAll<any>((fIdx: number, tIdx: number) => 
      supabase.from("suppliers").select("id,name").order("name").range(fIdx, tIdx),
      1000
    ),
  });

  const { data: products = [] } = useQuery({
    queryKey: ["report-products-minimal"],
    queryFn: async () => await fetchAll<any>((fIdx: number, tIdx: number) => 
      supabase.from("products").select("id,name,category,stock,sell_price,cost_price,preferred_supplier_id").range(fIdx, tIdx),
      1000
    ),
  });


  const stats = useMemo(() => {
    const pMap = new Map(products.map((p) => [p.id, p]));
    const sMap = new Map<string, {
      id: string;
      name: string;
      qty: number;
      revenue: number;
      invoices: Set<string>;
      products: Map<string, {
        id: string;
        name: string;
        qty: number;
        revenue: number;
        invoices: Set<string>;
        category: string;
        stock: number;
        cost: number;
      }>;
    }>();

    for (const s of sales) {
      for (const it of (s.sale_items as any[]) ?? []) {
        const prod = pMap.get(it.product_id);
        const sid = prod?.preferred_supplier_id || "unassigned";
        const sName = suppliers.find((x) => x.id === sid)?.name || (sid === "unassigned" ? t('reports.unassigned_supplier', 'Unassigned') : t('reports.unknown_supplier', 'Unknown'));

        if (!sMap.has(sid)) {
          sMap.set(sid, { id: sid, name: sName, qty: 0, revenue: 0, invoices: new Set(), products: new Map() });
        }
        const sData = sMap.get(sid)!;
        sData.qty += Number(it.qty);
        sData.revenue += Number(it.line_total);
        sData.invoices.add(s.id);

        if (!sData.products.has(it.product_id)) {
          sData.products.set(it.product_id, {
            id: it.product_id,
            name: it.name,
            qty: 0,
            revenue: 0,
            invoices: new Set(),
            category: prod?.category || "—",
            stock: Number(prod?.stock || 0),
            cost: Number(prod?.cost_price || 0),
          });
        }
        const pData = sData.products.get(it.product_id)!;
        pData.qty += Number(it.qty);
        pData.revenue += Number(it.line_total);
        pData.invoices.add(s.id);
      }
    }

    // Adjust for returns
    for (const r of saleReturns) {
      for (const it of (r.sale_return_items as any[]) ?? []) {
        const prod = pMap.get(it.product_id);
        const sid = prod?.preferred_supplier_id || "unassigned";
        if (!sMap.has(sid)) continue;
        const sData = sMap.get(sid)!;
        const pData = sData.products.get(it.product_id);
        if (!pData) continue;

        const rev = Number(it.qty) * Number(it.price);
        sData.qty -= Number(it.qty);
        sData.revenue -= rev;
        pData.qty -= Number(it.qty);
        pData.revenue -= rev;
      }
    }

    return sMap;
  }, [sales, saleReturns, products, suppliers]);

  const selectedData = stats.get(selectedSupplierId);
  const q = search.toLowerCase();

  const productList = useMemo(() => {
    if (!selectedData) return [];
    let list = Array.from(selectedData.products.values());
    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    }
    return list.sort((a, b) => {
      const va = sortBy === "qty" ? a.qty : a.revenue;
      const vb = sortBy === "qty" ? b.qty : b.revenue;
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [selectedData, q, sortBy, sortDir]);

  const toggleSort = (key: "qty" | "revenue") => {
    if (sortBy === key) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else { setSortBy(key); setSortDir("desc"); }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-muted/20">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs mb-1 block">{t('reports.filter_by_supplier', 'Filter by Company / Supplier')}</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value)}
            >
              <option value="all">{t('reports.choose_company', 'Choose a company…')}</option>
              {Array.from(stats.values())
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.name} {t('reports.option_items_suffix', '({{count}} items)', { count: s.products.size })}</option>
                ))}
            </select>
          </div>
          {selectedData && (
            <div className="flex gap-4">
              <StatMini label={t('reports.stat_products_sold', 'Products Sold')} value={selectedData.products.size} />
              <StatMini label={t('reports.stat_total_qty', 'Total Qty')} value={selectedData.qty} />
              <StatMini label={t('reports.stat_invoices', 'Invoices')} value={selectedData.invoices.size} />
              <StatMini label={t('reports.stat_total_sales', 'Total Sales')} value={fmtMoney(selectedData.revenue, currencySymbol)} tone="success" />
            </div>
          )}
        </div>
      </Card>

      {!selectedData ? (
        <Card className="p-12 text-center text-muted-foreground border-dashed">
          <div className="flex flex-col items-center gap-2">
            <Package className="h-10 w-10 opacity-20" />
            <p>{t('reports.select_company_prompt', 'Select a company to view the sales breakdown')}</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-3">
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="font-semibold text-sm">{t('reports.product_breakdown_heading', 'Product-wise Breakdown')}</h3>
                <div className="text-xs text-muted-foreground">{t('reports.sorted_by', 'Sorted by {{field}}', { field: sortBy === "qty" ? t('reports.sort_field_qty', 'Quantity') : t('reports.sort_field_revenue', 'Sale Amount') })}</div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('reports.th_product', 'Product')}</TableHead>
                    <TableHead>{t('reports.th_category', 'Category')}</TableHead>
                    <TableHead className="text-right">
                      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("qty")}>
                        {t('reports.th_qty_sold', 'Qty sold')}
                        <ArrowUpDown className={`h-3 w-3 ${sortBy === "qty" ? "opacity-100" : "opacity-30"}`} />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("revenue")}>
                        {t('reports.th_total_sale', 'Total Sale')}
                        <ArrowUpDown className={`h-3 w-3 ${sortBy === "revenue" ? "opacity-100" : "opacity-30"}`} />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productList.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">{t('reports.no_products_found', 'No products found')}</TableCell></TableRow>}
                  {productList.map((p) => (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => onDrill({
                        title: p.name,
                        note: t('reports.product_drill_note', '{{category}} · Qty {{qty}} · Current Stock {{stock}} · Total Sales {{total}}', { category: p.category, qty: p.qty, stock: p.stock, total: fmtMoney(p.revenue, currencySymbol) }),
                        cols: [t('reports.field_col', 'Field'), t('reports.value_col', 'Value')],
                        rows: [
                          [t('reports.th_category', 'Category'), p.category],
                          [t('reports.field_qty_sold', 'Quantity Sold'), p.qty],
                          [t('reports.field_total_sale_amount', 'Total Sale Amount'), fmtMoney(p.revenue, currencySymbol)],
                          [t('reports.field_avg_sale_price', 'Average Sale Price'), fmtMoney(p.qty > 0 ? p.revenue / p.qty : 0, currencySymbol)],
                          [t('reports.field_num_invoices', 'Number of Invoices'), p.invoices.size],
                          [t('reports.field_current_stock', 'Current Stock'), p.stock],
                          [t('reports.field_stock_value', 'Stock Value (Cost)'), fmtMoney(p.stock * p.cost, currencySymbol)],
                        ],
                      })}
                    >
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.category}</TableCell>
                      <TableCell className="text-right">{p.qty}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(p.revenue, currencySymbol)}</TableCell>
                      <TableCell className="text-right text-xs opacity-60">
                        {selectedData.revenue > 0 ? ((p.revenue / selectedData.revenue) * 100).toFixed(1) : "0"}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-4">
              <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-success" />
                {t('reports.top_selling_heading', 'Top Selling Products')}
              </h3>
              <div className="space-y-4">
                {productList.slice(0, 5).map((p, idx) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground">{t('reports.sold_of_total', '{{qty}} sold · {{pct}}% of total', { qty: p.qty, pct: ((p.revenue / selectedData.revenue) * 100).toFixed(1) })}</div>
                    </div>
                    <div className="text-sm font-semibold">{fmtMoney(p.revenue, currencySymbol)}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold text-sm mb-4">{t('reports.summary_heading', 'Summary')}</h3>
              <div className="space-y-3">
                <SummaryRow label={t('reports.summary_supplier_sales', 'Supplier Sales')} value={fmtMoney(selectedData.revenue, currencySymbol)} />
                <SummaryRow label={t('reports.summary_total_invoices', 'Total Invoices')} value={selectedData.invoices.size} />
                <SummaryRow label={t('reports.summary_items_sold', 'Items Sold')} value={selectedData.qty} />
                <SummaryRow label={t('reports.summary_avg_order_value', 'Avg. Order Value')} value={fmtMoney(selectedData.invoices.size > 0 ? selectedData.revenue / selectedData.invoices.size : 0, currencySymbol)} />
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

/** Pharmacy-only: sales grouped by generic/salt name instead of product —
 *  the report Pakistani pharmacy software (Oscar, HysabOne, MARS, etc.)
 *  uniformly leads with, per the business-type research. Mirrors the
 *  existing product-wise tab's aggregation exactly, just grouped by
 *  generic_name (via pharmacy_product_details) instead of product_id. */
function GenericWiseReport({
  sales,
  saleReturns,
  currencySymbol,
  search,
}: {
  sales: any[];
  saleReturns: any[];
  currencySymbol: string;
  search: string;
}) {
  const { t } = useTranslation();

  const { data: pharmacyDetails = [] } = useQuery({
    queryKey: ["report-pharmacy-details"],
    queryFn: async () =>
      await fetchAll<any>(
        (fIdx: number, tIdx: number) =>
          supabase.from("pharmacy_product_details" as any).select("product_id,generic_name").range(fIdx, tIdx),
        1000,
      ),
  });

  const genericByProduct = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of pharmacyDetails as any[]) {
      if (d.generic_name) m.set(d.product_id, d.generic_name);
    }
    return m;
  }, [pharmacyDetails]);

  const genericSales = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number; cost: number; profit: number; products: Set<string> }>();
    const noGeneric = t('reports.no_generic_assigned', 'No generic name assigned');
    for (const s of sales) {
      for (const it of (s.sale_items as any[]) ?? []) {
        const name = (it.product_id && genericByProduct.get(it.product_id)) || noGeneric;
        const cur = map.get(name) ?? { name, qty: 0, revenue: 0, cost: 0, profit: 0, products: new Set() };
        const rev = Number(it.line_total);
        const cost = Number(it.cost) * Number(it.qty);
        cur.qty += Number(it.qty); cur.revenue += rev; cur.cost += cost; cur.profit += rev - cost;
        if (it.product_id) cur.products.add(it.product_id);
        map.set(name, cur);
      }
    }
    for (const r of saleReturns) {
      for (const it of (r.sale_return_items as any[]) ?? []) {
        const name = (it.product_id && genericByProduct.get(it.product_id)) || noGeneric;
        const cur = map.get(name);
        if (!cur) continue;
        const rev = Number(it.qty) * Number(it.price);
        const cost = Number(it.qty) * Number(it.cost ?? 0);
        cur.qty -= Number(it.qty); cur.revenue -= rev; cur.cost -= cost; cur.profit -= rev - cost;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [sales, saleReturns, genericByProduct, t]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return genericSales;
    return genericSales.filter((g) => g.name.toLowerCase().includes(q));
  }, [genericSales, q]);

  return (
    <Card className="p-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reports.th_generic_name', 'Generic / salt name')}</TableHead>
            <TableHead className="text-right">{t('reports.th_products', 'Products')}</TableHead>
            <TableHead className="text-right">{t('reports.th_qty_sold', 'Qty sold')}</TableHead>
            <TableHead className="text-right">{t('reports.th_revenue', 'Revenue')}</TableHead>
            <TableHead className="text-right">{t('reports.th_cost', 'Cost')}</TableHead>
            <TableHead className="text-right">{t('reports.th_profit', 'Profit')}</TableHead>
            <TableHead className="text-right">{t('reports.th_margin', 'Margin %')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">{t('reports.no_data', 'No data')}</TableCell></TableRow>
          )}
          {filtered.map((g) => {
            const margin = g.revenue ? (g.profit / g.revenue) * 100 : 0;
            return (
              <TableRow key={g.name}>
                <TableCell className="font-medium">{g.name}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{g.products.size}</TableCell>
                <TableCell className="text-right">{g.qty}</TableCell>
                <TableCell className="text-right">{fmtMoney(g.revenue, currencySymbol)}</TableCell>
                <TableCell className="text-right">{fmtMoney(g.cost, currencySymbol)}</TableCell>
                <TableCell className="text-right text-success font-medium">{fmtMoney(g.profit, currencySymbol)}</TableCell>
                <TableCell className="text-right">{margin.toFixed(1)}%</TableCell>
              </TableRow>
            );
          })}
          {filtered.length > 0 && (
            <TableRow className="bg-muted/50 font-semibold">
              <TableCell>{t('reports.total_items_label', 'Total ({{count}} items)', { count: filtered.length })}</TableCell>
              <TableCell />
              <TableCell className="text-right">{filtered.reduce((a, b) => a + b.qty, 0)}</TableCell>
              <TableCell className="text-right">{fmtMoney(filtered.reduce((a, b) => a + b.revenue, 0), currencySymbol)}</TableCell>
              <TableCell className="text-right">{fmtMoney(filtered.reduce((a, b) => a + b.cost, 0), currencySymbol)}</TableCell>
              <TableCell className="text-right text-success">{fmtMoney(filtered.reduce((a, b) => a + b.profit, 0), currencySymbol)}</TableCell>
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Same shape as GenericWiseReport, grouped by products.rack_location
 *  instead of the generic/salt name — available for every business type
 *  since rack_location is a plain products column, not pharmacy-only. */
function RackWiseReport({
  sales,
  saleReturns,
  currencySymbol,
  search,
}: {
  sales: any[];
  saleReturns: any[];
  currencySymbol: string;
  search: string;
}) {
  const { t } = useTranslation();

  const { data: rackByProduct = new Map<string, string>() } = useQuery({
    queryKey: ["report-product-racks"],
    queryFn: async () => {
      const rows = await fetchAll<any>(
        (fIdx: number, tIdx: number) =>
          supabase.from("products").select("id,rack_location").range(fIdx, tIdx),
        1000,
      );
      const m = new Map<string, string>();
      for (const p of rows) if (p.rack_location) m.set(p.id, p.rack_location);
      return m;
    },
  });

  const rackSales = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number; cost: number; profit: number; products: Set<string> }>();
    const noRack = t('reports.no_rack_assigned', 'No rack assigned');
    for (const s of sales) {
      for (const it of (s.sale_items as any[]) ?? []) {
        const name = (it.product_id && rackByProduct.get(it.product_id)) || noRack;
        const cur = map.get(name) ?? { name, qty: 0, revenue: 0, cost: 0, profit: 0, products: new Set() };
        const rev = Number(it.line_total);
        const cost = Number(it.cost) * Number(it.qty);
        cur.qty += Number(it.qty); cur.revenue += rev; cur.cost += cost; cur.profit += rev - cost;
        if (it.product_id) cur.products.add(it.product_id);
        map.set(name, cur);
      }
    }
    for (const r of saleReturns) {
      for (const it of (r.sale_return_items as any[]) ?? []) {
        const name = (it.product_id && rackByProduct.get(it.product_id)) || noRack;
        const cur = map.get(name);
        if (!cur) continue;
        const rev = Number(it.qty) * Number(it.price);
        const cost = Number(it.qty) * Number(it.cost ?? 0);
        cur.qty -= Number(it.qty); cur.revenue -= rev; cur.cost -= cost; cur.profit -= rev - cost;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [sales, saleReturns, rackByProduct, t]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return rackSales;
    return rackSales.filter((g) => g.name.toLowerCase().includes(q));
  }, [rackSales, q]);

  return (
    <Card className="p-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reports.th_rack', 'Rack / shelf')}</TableHead>
            <TableHead className="text-right">{t('reports.th_products', 'Products')}</TableHead>
            <TableHead className="text-right">{t('reports.th_qty_sold', 'Qty sold')}</TableHead>
            <TableHead className="text-right">{t('reports.th_revenue', 'Revenue')}</TableHead>
            <TableHead className="text-right">{t('reports.th_cost', 'Cost')}</TableHead>
            <TableHead className="text-right">{t('reports.th_profit', 'Profit')}</TableHead>
            <TableHead className="text-right">{t('reports.th_margin', 'Margin %')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">{t('reports.no_data', 'No data')}</TableCell></TableRow>
          )}
          {filtered.map((g) => {
            const margin = g.revenue ? (g.profit / g.revenue) * 100 : 0;
            return (
              <TableRow key={g.name}>
                <TableCell className="font-medium">{g.name}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{g.products.size}</TableCell>
                <TableCell className="text-right">{g.qty}</TableCell>
                <TableCell className="text-right">{fmtMoney(g.revenue, currencySymbol)}</TableCell>
                <TableCell className="text-right">{fmtMoney(g.cost, currencySymbol)}</TableCell>
                <TableCell className="text-right text-success font-medium">{fmtMoney(g.profit, currencySymbol)}</TableCell>
                <TableCell className="text-right">{margin.toFixed(1)}%</TableCell>
              </TableRow>
            );
          })}
          {filtered.length > 0 && (
            <TableRow className="bg-muted/50 font-semibold">
              <TableCell>{t('reports.total_items_label', 'Total ({{count}} items)', { count: filtered.length })}</TableCell>
              <TableCell />
              <TableCell className="text-right">{filtered.reduce((a, b) => a + b.qty, 0)}</TableCell>
              <TableCell className="text-right">{fmtMoney(filtered.reduce((a, b) => a + b.revenue, 0), currencySymbol)}</TableCell>
              <TableCell className="text-right">{fmtMoney(filtered.reduce((a, b) => a + b.cost, 0), currencySymbol)}</TableCell>
              <TableCell className="text-right text-success">{fmtMoney(filtered.reduce((a, b) => a + b.profit, 0), currencySymbol)}</TableCell>
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Same shape as GenericWiseReport, grouped by manufacturer (pharmacy_product_details) —
 *  pharmacy-only since manufacturer only exists on that table. */
function CompanyWiseReport({
  sales,
  saleReturns,
  currencySymbol,
  search,
}: {
  sales: any[];
  saleReturns: any[];
  currencySymbol: string;
  search: string;
}) {
  const { t } = useTranslation();

  const { data: pharmacyDetails = [] } = useQuery({
    queryKey: ["report-pharmacy-details-manufacturer"],
    queryFn: async () =>
      await fetchAll<any>(
        (fIdx: number, tIdx: number) =>
          supabase.from("pharmacy_product_details" as any).select("product_id,manufacturer").range(fIdx, tIdx),
        1000,
      ),
  });

  const manufacturerByProduct = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of pharmacyDetails as any[]) {
      if (d.manufacturer) m.set(d.product_id, d.manufacturer);
    }
    return m;
  }, [pharmacyDetails]);

  const companySales = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number; cost: number; profit: number; products: Set<string> }>();
    const noCompany = t('reports.no_manufacturer_assigned', 'No company assigned');
    for (const s of sales) {
      for (const it of (s.sale_items as any[]) ?? []) {
        const name = (it.product_id && manufacturerByProduct.get(it.product_id)) || noCompany;
        const cur = map.get(name) ?? { name, qty: 0, revenue: 0, cost: 0, profit: 0, products: new Set() };
        const rev = Number(it.line_total);
        const cost = Number(it.cost) * Number(it.qty);
        cur.qty += Number(it.qty); cur.revenue += rev; cur.cost += cost; cur.profit += rev - cost;
        if (it.product_id) cur.products.add(it.product_id);
        map.set(name, cur);
      }
    }
    for (const r of saleReturns) {
      for (const it of (r.sale_return_items as any[]) ?? []) {
        const name = (it.product_id && manufacturerByProduct.get(it.product_id)) || noCompany;
        const cur = map.get(name);
        if (!cur) continue;
        const rev = Number(it.qty) * Number(it.price);
        const cost = Number(it.qty) * Number(it.cost ?? 0);
        cur.qty -= Number(it.qty); cur.revenue -= rev; cur.cost -= cost; cur.profit -= rev - cost;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [sales, saleReturns, manufacturerByProduct, t]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return companySales;
    return companySales.filter((g) => g.name.toLowerCase().includes(q));
  }, [companySales, q]);

  return (
    <Card className="p-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reports.th_company', 'Company / manufacturer')}</TableHead>
            <TableHead className="text-right">{t('reports.th_products', 'Products')}</TableHead>
            <TableHead className="text-right">{t('reports.th_qty_sold', 'Qty sold')}</TableHead>
            <TableHead className="text-right">{t('reports.th_revenue', 'Revenue')}</TableHead>
            <TableHead className="text-right">{t('reports.th_cost', 'Cost')}</TableHead>
            <TableHead className="text-right">{t('reports.th_profit', 'Profit')}</TableHead>
            <TableHead className="text-right">{t('reports.th_margin', 'Margin %')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">{t('reports.no_data', 'No data')}</TableCell></TableRow>
          )}
          {filtered.map((g) => {
            const margin = g.revenue ? (g.profit / g.revenue) * 100 : 0;
            return (
              <TableRow key={g.name}>
                <TableCell className="font-medium">{g.name}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{g.products.size}</TableCell>
                <TableCell className="text-right">{g.qty}</TableCell>
                <TableCell className="text-right">{fmtMoney(g.revenue, currencySymbol)}</TableCell>
                <TableCell className="text-right">{fmtMoney(g.cost, currencySymbol)}</TableCell>
                <TableCell className="text-right text-success font-medium">{fmtMoney(g.profit, currencySymbol)}</TableCell>
                <TableCell className="text-right">{margin.toFixed(1)}%</TableCell>
              </TableRow>
            );
          })}
          {filtered.length > 0 && (
            <TableRow className="bg-muted/50 font-semibold">
              <TableCell>{t('reports.total_items_label', 'Total ({{count}} items)', { count: filtered.length })}</TableCell>
              <TableCell />
              <TableCell className="text-right">{filtered.reduce((a, b) => a + b.qty, 0)}</TableCell>
              <TableCell className="text-right">{fmtMoney(filtered.reduce((a, b) => a + b.revenue, 0), currencySymbol)}</TableCell>
              <TableCell className="text-right">{fmtMoney(filtered.reduce((a, b) => a + b.cost, 0), currencySymbol)}</TableCell>
              <TableCell className="text-right text-success">{fmtMoney(filtered.reduce((a, b) => a + b.profit, 0), currencySymbol)}</TableCell>
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

function StatMini({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  const colors: Record<string, string> = { success: "text-success", destructive: "text-destructive" };
  return (
    <div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-bold ${tone ? colors[tone] : ""}`}>{value}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

const SPLIT_PAYMENT_PREFIX = "split:";

function parsePaymentSplit(methodValue: string | null | undefined, paidValue: number) {
  const raw = String(methodValue ?? "").trim();
  const paid = +Math.max(0, Number(paidValue || 0)).toFixed(2);
  if (!raw.startsWith(SPLIT_PAYMENT_PREFIX)) return [{ method: raw || "cash", amount: paid }];
  const rows = raw
    .slice(SPLIT_PAYMENT_PREFIX.length)
    .split("|")
    .filter(Boolean)
    .map((part) => {
      const [methodEncoded, amountRaw] = part.split("=");
      let decoded = methodEncoded || "";
      try { decoded = decodeURIComponent(methodEncoded || ""); } catch {}
      return {
        method: decoded.trim() || "cash",
        amount: +Math.max(0, Number(amountRaw || 0)).toFixed(2),
      };
    })
    .filter((entry) => entry.amount > 0);
  return rows.length ? rows : [{ method: "cash", amount: paid }];
}

const displayPaymentMethod = (methodValue: string | null | undefined) => {
  const rows = parsePaymentSplit(methodValue, 0);
  return rows.map((r) => r.method).join(" + ");
};

function today() { return new Date().toISOString().slice(0, 10); }

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
const toISO = (d: Date) => {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};

function Page() {
  const { t } = useTranslation();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const isPharmacy = useBusinessType() === "pharmacy";
  // Default range = shop's first ever transaction → today (never hide history).
  const { data: earliestData } = useEarliestDataDate();
  const [preset, setPreset] = useState<DatePreset | "custom">("all");
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(new Date());
  const [userPicked, setUserPicked] = useState(false);
  useEffect(() => {
    if (userPicked || !earliestData) return;
    setFromDate(earliestData);
    setToDate(new Date());
  }, [earliestData, userPicked]);
  const from = fromDate ? toISO(fromDate) : "1970-01-01";
  const to = toDate ? toISO(toDate) : today();
  

  const [tab, setTab] = useState("pnl");
  const [search, setSearch] = useState("");
  const [drill, setDrill] = useState<null | {
    title: string;
    note?: string;
    invoices?: any[];
    cols?: string[];
    rows?: (string | number)[][];
  }>(null);

  const applyPreset = (p: DatePreset) => {
    setUserPicked(true);
    setPreset(p);
    const { from: f, to: t } = rangeFor(p);
    if (p === "all") {
      setFromDate(earliestData ?? undefined);
      setToDate(new Date());
      return;
    }
    setFromDate(f ? new Date(f) : undefined);
    setToDate(t ? new Date(t) : undefined);
  };

  const presetLabel = preset === "custom" ? t('dashboard.custom_range', 'Custom range') : (PRESETS.find(p => p.key === preset)?.label ?? t('dashboard.today', 'Today'));

  const range = {
    // Correct PKT range: Start of fromDate at 00:00:00, End of toDate at 23:59:59.999
    from: fromDate ? new Date(new Date(fromDate).setHours(0, 0, 0, 0)).toISOString() : "2000-01-01T00:00:00Z",
    to: toDate ? new Date(new Date(toDate).setHours(23, 59, 59, 999)).toISOString() : new Date().toISOString(),
  };
  
  const fromTime = range.from;
  const toTime = range.to;



  const [salesPage, setSalesPage] = useState(0);
  const [purchasesPage, setPurchasesPage] = useState(0);
  const [expensesPage, setExpensesPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data: summaryStatsRaw } = useQuery({
    queryKey: ["reports-summary", fromTime, toTime],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_reports_summary", {
        p_from_date: fromTime,
        p_to_date: toTime
      });
      if (error) throw error;
      return data;
    },
  });
  const summaryStats = (summaryStatsRaw as any) || {};

  const { data: salesPaged = { data: [], count: 0 }, isLoading: salesLoading } = useQuery({
    queryKey: ["report-sales-paged", fromTime, toTime, salesPage, tab],
    queryFn: async () => {
      const q = supabase.from("sales")
        .select("id,invoice_no,subtotal,tax,discount,total,cost_total,paid,status,created_at,payment_method,customers(name),sale_items(name,qty,price,cost,line_total,product_id)", { count: "exact" })
        .gte("created_at", fromTime)
        .lte("created_at", toTime);

      if (tab === "sales") {
        q.eq("status", "completed");
      }

      q.order("created_at", { ascending: false })
        .range(salesPage * PAGE_SIZE, (salesPage + 1) * PAGE_SIZE - 1);
      
      const { data, count, error } = await q;
      if (error) throw error;
      return { data: data || [], count: count || 0 };
    },
  });
  const sales = salesPaged.data;

  // Full, unpaginated fetch for the whole date range — required by every
  // aggregate below (product-wise, daily/profit, payments, supplier-wise).
  // `sales` above is intentionally capped at PAGE_SIZE for the Invoice-wise
  // tab's own list; aggregating from it silently dropped everything past
  // the first page. These key names match the invalidations already fired
  // elsewhere (sale-returns.tsx, use-realtime-sync.ts) which were pointing
  // at query keys that didn't otherwise exist here.
  // These three "full" queries are the heaviest thing on this page (every
  // sale/return/purchase row, with line items, for the whole selected range
  // — up to all-time). A 5-minute staleTime means switching away and back to
  // Reports (or to a different tab within it) within that window reuses the
  // already-fetched data instead of re-downloading it; realtime no longer
  // invalidates these at all (see the comment in use-realtime-sync.ts), so
  // in practice this only truly refetches on an actual date-range change.
  const REPORT_FULL_STALE_TIME = 5 * 60 * 1000;

  const { data: allSales = [] } = useQuery({
    queryKey: ["report-sales-full", fromTime, toTime],
    queryFn: async () =>
      await fetchAll<any>((fIdx: number, tIdx: number) =>
        supabase
          .from("sales")
          .select("id,invoice_no,subtotal,tax,discount,total,cost_total,paid,status,created_at,payment_method,customers(name),sale_items(name,qty,price,cost,line_total,product_id)")
          .gte("created_at", fromTime)
          .lte("created_at", toTime)
          .neq("status", "voided")
          .order("created_at", { ascending: false })
          .range(fIdx, tIdx),
        1000,
      ),
    staleTime: REPORT_FULL_STALE_TIME,
  });

  const { data: allSaleReturns = [] } = useQuery({
    queryKey: ["report-sale-returns", fromTime, toTime],
    queryFn: async () =>
      await fetchAll<any>((fIdx: number, tIdx: number) =>
        supabase
          .from("sale_returns")
          .select("id,return_no,total,subtotal,tax,refund_amount,refund_method,created_at,customers(name),sale_return_items(name,qty,price,cost,product_id)")
          .gte("created_at", fromTime)
          .lte("created_at", toTime)
          .order("created_at", { ascending: false })
          .range(fIdx, tIdx),
        1000,
      ),
    staleTime: REPORT_FULL_STALE_TIME,
  });

  // Same pagination-vs-aggregate issue as sales: the "Total purchases" P&L
  // drill-down needs every purchase in the period, not just one page of it.
  const { data: allPurchases = [] } = useQuery({
    queryKey: ["report-purchases-full", fromTime, toTime],
    queryFn: async () =>
      await fetchAll<any>((fIdx: number, tIdx: number) =>
        supabase
          .from("purchases")
          .select("subtotal,tax,total,paid,created_at")
          .gte("created_at", fromTime)
          .lte("created_at", toTime)
          .order("created_at", { ascending: false })
          .range(fIdx, tIdx),
        1000,
      ),
    staleTime: REPORT_FULL_STALE_TIME,
  });

  const { data: purchasesPaged = { data: [], count: 0 } } = useQuery({
    queryKey: ["report-purchases-paged", fromTime, toTime, purchasesPage],
    queryFn: async () => {
      const { data, count, error } = await supabase.from("purchases")
        .select("subtotal,tax,total,paid,created_at", { count: "exact" })
        .gte("created_at", fromTime)
        .lte("created_at", toTime)
        .order("created_at", { ascending: false })
        .range(purchasesPage * PAGE_SIZE, (purchasesPage + 1) * PAGE_SIZE - 1);
      if (error) throw error;
      return { data: data || [], count: count || 0 };
    },
  });
  const purchases = purchasesPaged.data;

  const { data: expensesPaged = { data: [], count: 0 } } = useQuery({
    queryKey: ["report-expenses-paged", range.from, range.to, expensesPage],
    queryFn: async () => {
      const { data, count, error } = await supabase.from("expenses")
        .select("amount,category,expense_date", { count: "exact" })
        .gte("expense_date", fromTime.split("T")[0])
        .lte("expense_date", toTime.split("T")[0])
        .order("expense_date", { ascending: false })
        .range(expensesPage * PAGE_SIZE, (expensesPage + 1) * PAGE_SIZE - 1);
      if (error) throw error;
      return { data: data || [], count: count || 0 };
    },
  });
  const expenses = expensesPaged.data;

  const { data: partyPayments = [] } = useQuery({
    queryKey: ["report-party-payments-paged", fromTime, toTime],
    queryFn: async () => {
      // No FK-based embed here: party_payments has no FK to customers/suppliers,
      // so PostgREST embedding fails (PGRST200). Resolve names client-side.
      // Discounts are recorded as party_payments (method: "discount") so they
      // settle the customer ledger, but no cash actually moves — they don't
      // belong in a page about payment channels/cash flow.
      const base = supabase.from("party_payments")
        .select("id,party_type,party_id,amount,method,note,created_at")
        .neq("method", "discount")
        .gte("created_at", fromTime)
        .lte("created_at", toTime)
        .order("created_at", { ascending: false });
      const rows = await fetchAll<any>((fIdx: number, tIdx: number) => base.range(fIdx, tIdx), 1000);
      if (!rows.length) return rows;
      const custIds = [...new Set(rows.filter(r => r.party_type === "customer").map(r => r.party_id).filter(Boolean))];
      const supIds = [...new Set(rows.filter(r => r.party_type !== "customer").map(r => r.party_id).filter(Boolean))];
      const [custRes, supRes] = await Promise.all([
        custIds.length ? supabase.from("customers").select("id,name").in("id", custIds) : Promise.resolve({ data: [] as any[] }),
        supIds.length ? supabase.from("suppliers").select("id,name").in("id", supIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const cMap = new Map((custRes.data ?? []).map((c: any) => [c.id, c.name]));
      const sMap = new Map((supRes.data ?? []).map((s: any) => [s.id, s.name]));
      return rows.map((r) => ({
        ...r,
        customers: r.party_type === "customer" ? { name: cMap.get(r.party_id) ?? null } : null,
        suppliers: r.party_type !== "customer" ? { name: sMap.get(r.party_id) ?? null } : null,
      }));
    },
  });


  const [saleReturnsPage, setSaleReturnsPage] = useState(0);

  const { data: saleReturnsPaged = { data: [], count: 0 } } = useQuery({
    queryKey: ["report-sale-returns-paged", fromTime, toTime, saleReturnsPage],
    queryFn: async () => {
      const { data, count, error } = await supabase.from("sale_returns")
        .select("id,return_no,total,subtotal,tax,refund_amount,refund_method,created_at,customers(name),sale_return_items(name,qty,price,cost,product_id)", { count: "exact" })
        .gte("created_at", fromTime)
        .lte("created_at", toTime)
        .order("created_at", { ascending: false })
        .range(saleReturnsPage * PAGE_SIZE, (saleReturnsPage + 1) * PAGE_SIZE - 1);
      if (error) throw error;
      return { data: data || [], count: count || 0 };
    },
  });
  const saleReturns = saleReturnsPaged.data;
  const revenue = Number(summaryStats.sales_total || 0);
  const totalSales = Number(summaryStats.sales_total || 0);
  const returnsTotal = Number(summaryStats.returns_total || 0);
  const totalPurchases = Number(summaryStats.purchases_total || 0);
  const expensesPeriod = Number(summaryStats.expenses_total || 0);
  const taxCollected = Number(summaryStats.sales_tax || 0);
  const cogs = Number(summaryStats.sales_cost || 0);
  const grossProfit = revenue - cogs;
  // Supplier target incentives never touch the purchase bill — they're pure
  // bonus income, added straight to net profit.
  const incentiveTotal = Number(summaryStats.incentive_total || 0);
  // Kept identical to the Dashboard "Profit" tile (dashboard.tsx) on purpose —
  // both must always show the same bottom-line number. Gross profit above is
  // deliberately a narrower sales-margin figure (revenue − cost only); tax
  // collected and sale returns only come off starting here, at net profit.
  // Customer discounts settle the ledger without cash — a real cost, so
  // they come off profit the same way a return does.
  const discountTotal = Number(summaryStats.discount_total || 0);
  // A return's real hit to profit is only the margin that was on the
  // returned items, not the full refund — the shop gets the (resellable)
  // stock back, so cost_total already counted in `cogs` above isn't a loss.
  // Example: item cost 200, sold for 240 (profit 40) → returned → true loss
  // is 40, not the full 240 refunded.
  const returnsCost = Number(summaryStats.returns_cost || 0);
  const returnsProfitLoss = returnsTotal - returnsCost;
  const netProfit = grossProfit - taxCollected - returnsProfitLoss - expensesPeriod - discountTotal + incentiveTotal;
  const grossRevenue = revenue;
  const netOfReturns = revenue - returnsTotal;
  const creditOut = Number(summaryStats.credit_sales_total || 0);
  const cashIn = Number(summaryStats.cash_sales_total || 0);
  const returnsSubtotal = returnsTotal;

  // ---- drill-down helpers (every report row is clickable)
  const openInvoices = (title: string, list: any[], note?: string) =>
    setDrill({ title, note: note ?? t('reports.invoices_shown_note', '{{count}} invoice(s) shown', { count: list.length }), invoices: list });


  const openReturns = (title: string) =>
    setDrill({
      title,
      note: t('reports.returns_note', '{{count}} return(s)', { count: saleReturnsPaged.count }),
      cols: [t('sales.th_return_no', 'Return #'), t('sales.th_date', 'Date'), t('sales.th_customer', 'Customer'), t('reports.th_subtotal', 'Subtotal'), t('sales.th_refund', 'Refund'), t('sales.th_total', 'Total')],
      rows: (saleReturns as any[]).map((r) => [
        r.return_no ?? "—",
        new Date(r.created_at).toLocaleString(),
        r.customers?.name ?? t('common.walk_in', 'Walk-in'),
        fmtMoney(Number(r.subtotal ?? 0), sym),
        fmtMoney(Number(r.refund_amount ?? 0), sym),
        fmtMoney(Number(r.total ?? 0), sym),
      ]),
    });

  const openExpenses = () =>
    setDrill({
      title: t('reports.expenses_drill_title', 'Operating expenses'),
      note: t('reports.expenses_note', '{{count}} {{entryLabel}} · {{amount}}', { count: expensesPaged.count, entryLabel: expensesPaged.count === 1 ? t('reports.entry_singular', 'entry') : t('reports.entry_plural', 'entries'), amount: fmtMoney(expensesPeriod, sym) }),
      cols: [t('sales.th_date', 'Date'), t('reports.th_category', 'Category'), t('common.amount', 'Amount')],
      rows: (expenses as any[]).map((e) => [e.expense_date, e.category ?? "—", fmtMoney(Number(e.amount), sym)]),
    });

  const openPurchases = () =>
    setDrill({
      title: t('reports.purchases_drill_title', 'Purchases (period)'),
      note: t('reports.purchases_note', '{{count}} purchase(s) · {{amount}}', { count: purchasesPaged.count, amount: fmtMoney(totalPurchases, sym) }),
      cols: [t('sales.th_date', 'Date'), t('reports.th_subtotal', 'Subtotal'), t('reports.th_tax', 'Tax'), t('sales.th_total', 'Total'), t('sales.th_paid', 'Paid')],
      rows: (allPurchases as any[]).map((p) => [
        new Date(p.created_at).toLocaleString(),
        fmtMoney(Number(p.subtotal ?? 0), sym),
        fmtMoney(Number(p.tax ?? 0), sym),
        fmtMoney(Number(p.total ?? 0), sym),
        fmtMoney(Number(p.paid ?? 0), sym),
      ]),
    });


  // Daily sale report
  const dailySales = useMemo(() => {
    const map = new Map<string, { date: string; invoices: number; qty: number; revenue: number; tax: number; total: number; profit: number }>();
    for (const s of allSales as any[]) {
      const d = new Date(s.created_at).toISOString().slice(0, 10);
      const rev = Number(s.subtotal) - Number(s.discount);
      const profit = rev - Number(s.cost_total);
      const qty = (s.sale_items ?? []).reduce((a: number, i: any) => a + Number(i.qty), 0);
      const cur = map.get(d) ?? { date: d, invoices: 0, qty: 0, revenue: 0, tax: 0, total: 0, profit: 0 };
      cur.invoices += 1; cur.qty += qty; cur.revenue += rev; cur.tax += Number(s.tax); cur.total += Number(s.total); cur.profit += profit;
      map.set(d, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [allSales]);

  // Product-wise
  const productSales = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number; cost: number; profit: number }>();
    for (const s of allSales as any[]) {
      for (const it of s.sale_items ?? []) {
        const key = it.product_id || it.name;
        const cur = map.get(key) ?? { name: it.name, qty: 0, revenue: 0, cost: 0, profit: 0 };
        const rev = Number(it.line_total);
        const cost = Number(it.cost) * Number(it.qty);
        cur.qty += Number(it.qty); cur.revenue += rev; cur.cost += cost; cur.profit += rev - cost;
        map.set(key, cur);
      }
    }
    // Subtract returned qty/revenue/cost per product so product-wise report reflects net sales
    for (const r of allSaleReturns as any[]) {
      for (const it of r.sale_return_items ?? []) {
        const key = it.product_id || it.name;
        const cur = map.get(key);
        if (!cur) continue;
        const rev = Number(it.qty) * Number(it.price);
        const cost = Number(it.qty) * Number(it.cost ?? 0);
        cur.qty -= Number(it.qty); cur.revenue -= rev; cur.cost -= cost; cur.profit -= rev - cost;
        map.set(key, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [allSales, allSaleReturns]);

  // Payment method breakdown
  const paymentBreakdown = useMemo(() => {
    const map = new Map<string, { method: string; invoices: number; total: number; paid: number }>();
    for (const s of allSales as any[]) {
      const splits = parsePaymentSplit(s.payment_method, Number(s.paid));
      const splitPaidTotal = splits.reduce((sum, split) => sum + Number(split.amount || 0), 0);
      for (const split of splits) {
        const method = split.method || "unknown";
        const cur = map.get(method) ?? { method, invoices: 0, total: 0, paid: 0 };
        const share = splitPaidTotal > 0 ? Number(split.amount || 0) / splitPaidTotal : 1 / splits.length;
        cur.invoices += 1;
        cur.total += Number(s.total) * share;
        cur.paid += Number(split.amount || 0);
        map.set(method, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.paid - a.paid);
  }, [allSales]);

  // Combined method cash-flow: money IN (sales + customer party-payments) vs money OUT (supplier party-payments)
  const methodFlow = useMemo(() => {
    const map = new Map<string, { method: string; in_sales: number; in_customer: number; out_supplier: number; net: number }>();
    const get = (m: string) => {
      const cur = map.get(m) ?? { method: m, in_sales: 0, in_customer: 0, out_supplier: 0, net: 0 };
      map.set(m, cur); return cur;
    };
    for (const s of allSales as any[]) {
      const splits = parsePaymentSplit(s.payment_method, Number(s.paid));
      for (const split of splits) {
        const cur = get((split.method || "unknown").toLowerCase());
        cur.in_sales += Number(split.amount || 0);
      }
    }
    for (const p of partyPayments as any[]) {
      const cur = get((p.method || "unknown").toLowerCase());
      if (p.party_type === "customer") cur.in_customer += Number(p.amount);
      else cur.out_supplier += Number(p.amount);
    }
    for (const v of map.values()) v.net = v.in_sales + v.in_customer - v.out_supplier;
    return Array.from(map.values()).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [allSales, partyPayments]);

  const debouncedSearch = useDebounced(search, 200);
  const q = debouncedSearch.trim().toLowerCase();
  const filteredInvoices = useMemo(() => {
    if (!q) return sales as any[];
    if (q === "status:credit") return (sales as any[]).filter(s => s.status === "credit");
    return (sales as any[]).filter((s) =>
      String(s.invoice_no ?? "").toLowerCase().includes(q) ||
      String(s.customers?.name ?? "walk-in").toLowerCase().includes(q) ||
      displayPaymentMethod(s.payment_method).toLowerCase().includes(q) ||
      String(Number(s.total).toFixed(2)).includes(q) ||
      (s.sale_items ?? []).some((i: any) => String(i.name).toLowerCase().includes(q))
    );
  }, [sales, q]);
  const filteredProducts = useMemo(() => {
    if (!q) return productSales;
    return productSales.filter((p) => p.name.toLowerCase().includes(q));
  }, [productSales, q]);


  return (
    <div className="p-6 space-y-4">
      <NeedsInternetBanner section={t('reports.title', 'Reports')} />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('reports.title', 'Reports')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('reports.subtitle', 'Sales, profit, invoice & product breakdowns')} · {presetLabel}
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
          {salesLoading && <Badge variant="outline" className="animate-pulse">{t('reports.loading', 'Loading...')}</Badge>}
          <Button variant="outline" size="sm" onClick={() => printDocument()}><Printer className="h-4 w-4 mr-2" /> {t('common.print', 'Print')}</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 no-print">
        {PRESETS.map(p => (
          <Button
            key={p.key}
            variant={preset === p.key ? "default" : "outline"}
            size="sm"
            onClick={() => applyPreset(p.key)}
          >
            {p.label}
          </Button>
        ))}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={preset === "custom" ? "default" : "outline"}
              size="sm"
              className={cn("gap-2")}
            >
              <CalendarIcon className="h-4 w-4" />
              {fromDate && toDate
                ? `${format(fromDate, "dd MMM")} - ${format(toDate, "dd MMM")}`
                : t('dashboard.custom_range', 'Custom range')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              selected={{ from: fromDate, to: toDate }}
              onSelect={(r) => {
                setUserPicked(true);
                setPreset("custom");
                setFromDate(r?.from);
                setToDate(r?.to);
              }}
              numberOfMonths={2}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
      </div>


      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat icon={TrendingUp} label={t('reports.stat_revenue', 'Revenue')} value={fmtMoney(revenue, sym)} tone="primary" />
        <Stat icon={TrendingDown} label={t('reports.stat_cost_of_goods', 'Cost of goods')} value={fmtMoney(cogs, sym)} tone="destructive" />
        <Stat icon={Wallet} label={t('reports.stat_gross_profit', 'Gross profit')} value={fmtMoney(grossProfit, sym)} tone="success" />
        <Stat icon={CreditCard} label={t('reports.stat_credit_sales', 'Credit sales')} value={fmtMoney(creditOut, sym)} tone="warning" onClick={() => {
          setTab("invoice");
          setSearch("status:credit");
        }} />
        <Stat icon={TrendingDown} label={t('reports.stat_expenses_period', 'Expenses (period)')} value={fmtMoney(expensesPeriod, sym)} tone="warning" />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="doc-print-area">
        <div className="flex items-center justify-between gap-2 flex-wrap no-print">
          <TabsList>
            <TabsTrigger value="pnl">{t('reports.tab_pnl', 'P&L')}</TabsTrigger>
            <TabsTrigger value="sales">{t('reports.tab_sales', 'Sale report')}</TabsTrigger>
            <TabsTrigger value="profit">{t('reports.tab_profit', 'Sale & profit')}</TabsTrigger>
            <TabsTrigger value="invoice">{t('reports.tab_invoice', 'Invoice-wise')}</TabsTrigger>
            <TabsTrigger value="product">{t('reports.tab_product', 'Product-wise')}</TabsTrigger>
            <TabsTrigger value="payments">{t('reports.tab_payments', 'Payments')}</TabsTrigger>
            <TabsTrigger value="supplier">{t('reports.tab_supplier', 'Supplier Wise')}</TabsTrigger>
            {isPharmacy && <TabsTrigger value="generic">{t('reports.tab_generic', 'Salt Wise')}</TabsTrigger>}
            <TabsTrigger value="rack">{t('reports.tab_rack', 'Rack Wise')}</TabsTrigger>
            {isPharmacy && <TabsTrigger value="company">{t('reports.tab_company', 'Company Wise')}</TabsTrigger>}
          </TabsList>
          {(tab === "invoice" || tab === "product" || tab === "supplier" || tab === "generic") && (
            <Input
              placeholder={tab === "product" ? t('reports.search_product_placeholder', 'Search product name…') : tab === "supplier" ? t('reports.search_supplier_placeholder', 'Search supplier or product…') : tab === "generic" ? t('reports.search_generic_placeholder', 'Search generic/salt name…') : t('reports.search_invoice_placeholder', 'Search invoice, customer, amount…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 max-w-xs"
            />
          )}
        </div>

        <TabsContent value="pnl">
          <Card className="p-5">
            <h2 className="font-semibold mb-3">{t('reports.pnl_heading', 'Profit & Loss Statement')}</h2>
            <Table>
              <TableBody>
                <Row label={t('reports.row_gross_sales', 'Gross sales (before returns)')} value={fmtMoney(grossRevenue, sym)} muted onClick={() => openInvoices(t('reports.row_gross_sales', 'Gross sales (before returns)'), allSales as any[])} />
                <Row label={t('reports.row_sale_returns', 'Sale returns')} value={`(${fmtMoney(returnsSubtotal, sym)})`} muted onClick={() => openReturns(t('reports.row_sale_returns', 'Sale returns'))} />
                <Row label={t('reports.row_net_of_returns', 'Sales (net of returns & discount)')} value={fmtMoney(netOfReturns, sym)} onClick={() => openInvoices(t('reports.row_net_of_returns', 'Sales (net of returns & discount)'), allSales as any[])} />
                <Row label={t('reports.row_cogs', 'Cost of goods sold')} value={`(${fmtMoney(cogs, sym)})`} onClick={() => openInvoices(t('reports.row_cogs', 'Cost of goods sold'), allSales as any[])} />
                <Row label={t('reports.row_gross_profit', 'Gross profit')} value={fmtMoney(grossProfit, sym)} bold onClick={() => openInvoices(t('reports.row_gross_profit', 'Gross profit'), allSales as any[])} />
                <Row label={t('reports.row_sale_returns_loss', 'Sale returns (loss)')} value={`(${fmtMoney(returnsProfitLoss, sym)})`} onClick={() => openReturns(t('reports.row_sale_returns', 'Sale returns'))} />
                <Row label={t('reports.row_operating_expenses', 'Operating expenses')} value={`(${fmtMoney(expensesPeriod, sym)})`} onClick={openExpenses} />
                <Row label={t('reports.row_tax_collected', 'Tax collected')} value={`(${fmtMoney(taxCollected, sym)})`} onClick={() => openInvoices(t('reports.row_tax_collected', 'Tax collected'), (allSales as any[]).filter((s) => Number(s.tax) > 0))} />
                {discountTotal > 0 && (
                  <Row label={t('reports.row_customer_discounts', 'Customer discounts')} value={`(${fmtMoney(discountTotal, sym)})`} muted />
                )}
                <Row label={t('reports.row_credit_sales_period', 'Credit sales (period)')} value={fmtMoney(creditOut, sym)} muted onClick={() => {
                  setTab("invoice");
                  setSearch("status:credit");
                }} />
                <Row label={t('reports.row_total_purchases_period', 'Total purchases (period)')} value={fmtMoney(totalPurchases, sym)} muted onClick={openPurchases} />
                {incentiveTotal > 0 && (
                  <Row label={t('reports.row_supplier_incentives', 'Supplier incentives')} value={`+${fmtMoney(incentiveTotal, sym)}`} onClick={openPurchases} />
                )}
                <Row label={t('reports.row_net_profit', 'Net profit')} value={fmtMoney(netProfit, sym)} bold accent onClick={() => openInvoices(t('reports.drill_net_profit_title', 'Net profit basis · all invoices'), allSales as any[])} />

              </TableBody>
            </Table>
            <div className="text-xs text-muted-foreground mt-3">{t('reports.pnl_footer', '{{from}} → {{to}} · {{sales}} sales, {{purchases}} purchases, {{expenses}} expenses', { from, to, sales: salesPaged.count, purchases: purchasesPaged.count, expenses: expensesPaged.count })}</div>
          </Card>
        </TabsContent>

        <TabsContent value="sales">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('sales.th_date', 'Date')}</TableHead><TableHead className="text-right">{t('reports.th_invoices', 'Invoices')}</TableHead>
                <TableHead className="text-right">{t('reports.th_items_qty', 'Items qty')}</TableHead><TableHead className="text-right">{t('reports.th_revenue', 'Revenue')}</TableHead>
                <TableHead className="text-right">{t('reports.th_tax', 'Tax')}</TableHead><TableHead className="text-right">{t('sales.th_total', 'Total')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {dailySales.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">{t('reports.no_sales', 'No sales')}</TableCell></TableRow>}
                {dailySales.map((d) => (
                  <TableRow
                    key={d.date}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openInvoices(t('reports.drill_sales_on', 'Sales on {{date}}', { date: d.date }), (allSales as any[]).filter((s) => new Date(s.created_at).toISOString().slice(0, 10) === d.date))}
                  >
                    <TableCell>{d.date}</TableCell>
                    <TableCell className="text-right">{d.invoices}</TableCell>
                    <TableCell className="text-right">{d.qty}</TableCell>
                    <TableCell className="text-right">{fmtMoney(d.revenue, sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(d.tax, sym)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(d.total, sym)}</TableCell>
                  </TableRow>
                ))}
                {dailySales.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>{t('reports.total_label', 'Total')}</TableCell>
                    <TableCell className="text-right">{dailySales.reduce((a, b) => a + b.invoices, 0)}</TableCell>
                    <TableCell className="text-right">{dailySales.reduce((a, b) => a + b.qty, 0)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(revenue, sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(taxCollected, sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(totalSales, sym)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="profit">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('sales.th_date', 'Date')}</TableHead><TableHead className="text-right">{t('reports.th_invoices', 'Invoices')}</TableHead>
                <TableHead className="text-right">{t('reports.th_revenue', 'Revenue')}</TableHead><TableHead className="text-right">{t('reports.th_cost', 'Cost')}</TableHead>
                <TableHead className="text-right">{t('reports.th_profit', 'Profit')}</TableHead><TableHead className="text-right">{t('reports.th_margin', 'Margin %')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {dailySales.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">{t('reports.no_data', 'No data')}</TableCell></TableRow>}
                {dailySales.map((d) => {
                  const cost = d.revenue - d.profit;
                  const margin = d.revenue ? (d.profit / d.revenue) * 100 : 0;
                  return (
                    <TableRow
                      key={d.date}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openInvoices(t('reports.drill_sales_profit_on', 'Sales & profit on {{date}}', { date: d.date }), (allSales as any[]).filter((s) => new Date(s.created_at).toISOString().slice(0, 10) === d.date))}
                    >
                      <TableCell>{d.date}</TableCell>
                      <TableCell className="text-right">{d.invoices}</TableCell>
                      <TableCell className="text-right">{fmtMoney(d.revenue, sym)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(cost, sym)}</TableCell>
                      <TableCell className="text-right text-success font-medium">{fmtMoney(d.profit, sym)}</TableCell>
                      <TableCell className="text-right">{margin.toFixed(1)}%</TableCell>
                    </TableRow>
                  );
                })}
                {dailySales.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>{t('reports.total_label', 'Total')}</TableCell>
                    <TableCell className="text-right">{dailySales.reduce((a, b) => a + b.invoices, 0)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(revenue, sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(cogs, sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(grossProfit, sym)}</TableCell>
                    <TableCell className="text-right">{revenue ? ((grossProfit / revenue) * 100).toFixed(1) : "0.0"}%</TableCell>
                  </TableRow>
                )}
              </TableBody>
             </Table>
           </Card>
        </TabsContent>

        <TabsContent value="invoice">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('sales.th_invoice', 'Invoice')}</TableHead><TableHead>{t('sales.th_date', 'Date')}</TableHead><TableHead>{t('sales.th_customer', 'Customer')}</TableHead>
                <TableHead>{t('sales.th_method', 'Method')}</TableHead><TableHead className="text-right">{t('reports.th_items', 'Items')}</TableHead>
                <TableHead className="text-right">{t('sales.th_total', 'Total')}</TableHead><TableHead className="text-right">{t('reports.th_profit', 'Profit')}</TableHead>
                <TableHead>{t('sales.th_status', 'Status')}</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredInvoices.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">{t('reports.no_invoices', 'No invoices')}</TableCell></TableRow>}
                {filteredInvoices.map((s: any) => {
                  const profit = (Number(s.subtotal || 0) - Number(s.discount || 0)) - Number(s.cost_total || 0);
                  const qty = (s.sale_items as any[] ?? []).reduce((a: number, i: any) => a + Number(i.qty || 0), 0);
                  return (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-muted/50"

                      onClick={() => setDrill({
                        title: t('reports.invoice_drill_title', 'Invoice {{invoice}}', { invoice: s.invoice_no }),
                        note: t('reports.invoice_drill_note', '{{date}} · {{customer}} · {{method}} · Total {{total}} · Paid {{paid}}', { date: new Date(s.created_at).toLocaleString(), customer: s.customers?.name ?? t('common.walk_in', 'Walk-in'), method: displayPaymentMethod(s.payment_method), total: fmtMoney(Number(s.total), sym), paid: fmtMoney(Number(s.paid), sym) }),
                        cols: [t('reports.th_item', 'Item'), t('reports.th_qty', 'Qty'), t('reports.th_price', 'Price'), t('reports.th_line_total', 'Line total')],
                        rows: (s.sale_items as any[] ?? []).map((i: any) => [
                          i.name,
                          Number(i.qty || 0),
                          fmtMoney(Number(i.price || 0), sym),
                          fmtMoney(Number(i.line_total || 0), sym),
                        ]),
                      })}
                    >
                      <TableCell className="font-mono text-xs">{s.invoice_no}</TableCell>
                      <TableCell className="text-sm">{new Date(s.created_at).toLocaleString()}</TableCell>
                      <TableCell>{s.customers?.name ?? t('common.walk_in', 'Walk-in')}</TableCell>
                      <TableCell className="capitalize">{displayPaymentMethod(s.payment_method)}</TableCell>
                      <TableCell className="text-right">{qty}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(s.total, sym)}</TableCell>
                      <TableCell className="text-right text-success">{fmtMoney(profit, sym)}</TableCell>
                      <TableCell><Badge variant={s.status === "completed" ? "outline" : s.status === "credit" ? "secondary" : "destructive"}>{String(t(`sales.status_${s.status}`, s.status))}</Badge></TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}><Button asChild variant="ghost" size="icon"><Link to="/sales"><Eye className="h-4 w-4" /></Link></Button></TableCell>
                    </TableRow>
                  );
                })}
                {filteredInvoices.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={5}>{q ? t('reports.total_invoices_of_label', 'Total ({{count}} invoices of {{total}})', { count: filteredInvoices.length, total: sales.length }) : t('reports.total_invoices_label', 'Total ({{count}} invoices)', { count: filteredInvoices.length })}</TableCell>
                    <TableCell className="text-right">{fmtMoney(filteredInvoices.reduce((a, b: any) => a + Number(b.total), 0), sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(filteredInvoices.reduce((a, b: any) => a + ((Number(b.subtotal) - Number(b.discount)) - Number(b.cost_total)), 0), sym)}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                )}
              </TableBody>
             </Table>
             {salesPaged.count > PAGE_SIZE && (
               <div className="p-4 flex items-center justify-between border-t text-sm">
                 <div className="text-muted-foreground">{t('reports.showing_invoices', 'Showing {{from}} to {{to}} of {{total}} invoices', { from: salesPage * PAGE_SIZE + 1, to: Math.min((salesPage + 1) * PAGE_SIZE, salesPaged.count), total: salesPaged.count })}</div>
                 <div className="flex gap-2">
                   <Button variant="outline" size="sm" onClick={() => setSalesPage(p => Math.max(0, p - 1))} disabled={salesPage === 0}>{t('reports.previous', 'Previous')}</Button>
                   <Button variant="outline" size="sm" onClick={() => setSalesPage(p => p + 1)} disabled={(salesPage + 1) * PAGE_SIZE >= salesPaged.count}>{t('reports.next', 'Next')}</Button>
                 </div>
               </div>
             )}
           </Card>
         </TabsContent>

        <TabsContent value="product">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('reports.th_product', 'Product')}</TableHead>
                <TableHead className="text-right">{t('reports.th_qty_sold', 'Qty sold')}</TableHead>
                <TableHead className="text-right">{t('reports.th_revenue', 'Revenue')}</TableHead>
                <TableHead className="text-right">{t('reports.th_cost', 'Cost')}</TableHead>
                <TableHead className="text-right">{t('reports.th_profit', 'Profit')}</TableHead>
                <TableHead className="text-right">{t('reports.th_margin', 'Margin %')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredProducts.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">{t('reports.no_data', 'No data')}</TableCell></TableRow>}
                {filteredProducts.map((p, i) => {
                  const margin = p.revenue ? (p.profit / p.revenue) * 100 : 0;
                  return (
                    <TableRow
                      key={i}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        const rows: (string | number)[][] = [];
                        for (const s of allSales as any[]) {
                          for (const it of (s.sale_items as any[]) ?? []) {
                            if (it.name !== p.name) continue;
                            rows.push([
                              s.invoice_no,
                              new Date(s.created_at).toLocaleString(),
                              s.customers?.name ?? t('common.walk_in', 'Walk-in'),
                              Number(it.qty),
                              fmtMoney(Number(it.line_total), sym),
                            ]);
                          }
                        }
                        setDrill({
                          title: p.name,
                          note: t('reports.product_line_drill_note', '{{count}} invoice line(s) · Qty {{qty}} · Revenue {{revenue}}', { count: rows.length, qty: p.qty, revenue: fmtMoney(p.revenue, sym) }),
                          cols: [t('sales.th_invoice', 'Invoice'), t('sales.th_date', 'Date'), t('sales.th_customer', 'Customer'), t('reports.th_qty', 'Qty'), t('common.amount', 'Amount')],
                          rows,
                        });
                      }}
                    >
                      <TableCell>{p.name}</TableCell>
                      <TableCell className="text-right">{p.qty}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.revenue, sym)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.cost, sym)}</TableCell>
                      <TableCell className="text-right text-success font-medium">{fmtMoney(p.profit, sym)}</TableCell>
                      <TableCell className="text-right">{margin.toFixed(1)}%</TableCell>
                    </TableRow>
                  );
                })}
                {filteredProducts.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>{q ? t('reports.total_items_of_label', 'Total ({{count}} items of {{total}})', { count: filteredProducts.length, total: productSales.length }) : t('reports.total_items_label', 'Total ({{count}} items)', { count: filteredProducts.length })}</TableCell>
                    <TableCell className="text-right">{filteredProducts.reduce((a, b) => a + b.qty, 0)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(filteredProducts.reduce((a, b) => a + b.revenue, 0), sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(filteredProducts.reduce((a, b) => a + b.cost, 0), sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(filteredProducts.reduce((a, b) => a + b.profit, 0), sym)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('reports.th_payment_method', 'Payment method')}</TableHead>
                <TableHead className="text-right">{t('reports.th_invoices', 'Invoices')}</TableHead>
                <TableHead className="text-right">{t('reports.th_total_billed', 'Total billed')}</TableHead>
                <TableHead className="text-right">{t('reports.th_received', 'Received')}</TableHead>
                <TableHead className="text-right">{t('reports.th_outstanding', 'Outstanding')}</TableHead>
                <TableHead className="text-right">{t('reports.th_share', 'Share %')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {paymentBreakdown.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">{t('reports.no_payments', 'No payments')}</TableCell></TableRow>}
                {paymentBreakdown.map((p) => {
                  const totalPaid = paymentBreakdown.reduce((a, b) => a + b.paid, 0);
                  const share = totalPaid ? (p.paid / totalPaid) * 100 : 0;
                  return (
                    <TableRow
                      key={p.method}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openInvoices(
                        t('reports.drill_payments_title', 'Payments · {{method}}', { method: p.method }),
                        (allSales as any[]).filter((s) => parsePaymentSplit(s.payment_method, Number(s.paid)).some((x) => (x.method || "unknown") === p.method)),
                        t('reports.drill_payments_note', '{{count}} invoice(s) · Received {{amount}}', { count: p.invoices, amount: fmtMoney(p.paid, sym) }),
                      )}
                    >
                      <TableCell className="capitalize font-medium">{p.method}</TableCell>
                      <TableCell className="text-right">{p.invoices}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.total, sym)}</TableCell>
                      <TableCell className="text-right text-success font-medium">{fmtMoney(p.paid, sym)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.total - p.paid, sym)}</TableCell>
                      <TableCell className="text-right">{share.toFixed(1)}%</TableCell>
                    </TableRow>
                  );
                })}
                {paymentBreakdown.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>{t('reports.total_label', 'Total')}</TableCell>
                    <TableCell className="text-right">{paymentBreakdown.reduce((a, b) => a + b.invoices, 0)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(paymentBreakdown.reduce((a, b) => a + b.total, 0), sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(paymentBreakdown.reduce((a, b) => a + b.paid, 0), sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(paymentBreakdown.reduce((a, b) => a + (b.total - b.paid), 0), sym)}</TableCell>
                    <TableCell className="text-right">100.0%</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>

          <Card className="p-3 mt-4">
            <div className="mb-2">
              <div className="text-sm font-semibold">{t('reports.money_flow_heading', 'Money flow by payment channel')}</div>
              <div className="text-xs text-muted-foreground">{t('reports.money_flow_desc', 'Tracks each channel (cash, card, JazzCash, EasyPaisa…) — money received via sales & customer payments vs money paid out to suppliers.')}</div>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('reports.th_channel', 'Channel')}</TableHead>
                <TableHead className="text-right">{t('reports.th_in_sales', 'In · Sales')}</TableHead>
                <TableHead className="text-right">{t('reports.th_in_customer', 'In · Customer payments')}</TableHead>
                <TableHead className="text-right">{t('reports.th_out_supplier', 'Out · Supplier payments')}</TableHead>
                <TableHead className="text-right">{t('reports.th_net', 'Net (In − Out)')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {methodFlow.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">{t('reports.no_activity', 'No activity')}</TableCell></TableRow>}
                {methodFlow.map((m) => (
                  <TableRow
                    key={m.method}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => {
                      const rows: (string | number)[][] = [];
                      for (const s of allSales as any[]) {
                        for (const split of parsePaymentSplit(s.payment_method, Number(s.paid))) {
                          if ((split.method || "unknown").toLowerCase() !== m.method) continue;
                          rows.push([new Date(s.created_at).toLocaleString(), t('reports.in_sale_type', 'In · Sale'), s.invoice_no, s.customers?.name ?? t('common.walk_in', 'Walk-in'), fmtMoney(Number(split.amount), sym)]);
                        }
                      }
                      for (const p of partyPayments as any[]) {
                        if ((p.method || "unknown").toLowerCase() !== m.method) continue;
                        rows.push([
                          new Date(p.created_at).toLocaleString(),
                          p.party_type === "customer" ? t('reports.in_customer_payment_type', 'In · Customer payment') : t('reports.out_supplier_payment_type', 'Out · Supplier payment'),
                          p.note || "—",
                          p.customers?.name ?? p.suppliers?.name ?? "—",
                          `${p.party_type === "customer" ? "+" : "−"}${fmtMoney(Number(p.amount), sym)}`,
                        ]);
                      }
                      setDrill({
                        title: t('reports.channel_drill_title', 'Channel · {{method}}', { method: m.method }),
                        note: t('reports.channel_drill_note', '{{count}} entries · Net {{net}}', { count: rows.length, net: fmtMoney(m.net, sym) }),
                        cols: [t('sales.th_date', 'Date'), t('reports.th_type', 'Type'), t('reports.th_reference', 'Reference'), t('reports.th_party', 'Party'), t('common.amount', 'Amount')],
                        rows,
                      });
                    }}
                  >
                    <TableCell className="capitalize font-medium">{m.method}</TableCell>
                    <TableCell className="text-right text-success">{m.in_sales ? fmtMoney(m.in_sales, sym) : "—"}</TableCell>
                    <TableCell className="text-right text-success">{m.in_customer ? fmtMoney(m.in_customer, sym) : "—"}</TableCell>
                    <TableCell className="text-right text-destructive">{m.out_supplier ? fmtMoney(m.out_supplier, sym) : "—"}</TableCell>
                    <TableCell className={`text-right font-semibold ${m.net > 0 ? "text-success" : m.net < 0 ? "text-destructive" : ""}`}>{fmtMoney(m.net, sym)}</TableCell>
                  </TableRow>
                ))}
                {methodFlow.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>{t('reports.total_label', 'Total')}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(methodFlow.reduce((a, b) => a + b.in_sales, 0), sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(methodFlow.reduce((a, b) => a + b.in_customer, 0), sym)}</TableCell>
                    <TableCell className="text-right text-destructive">{fmtMoney(methodFlow.reduce((a, b) => a + b.out_supplier, 0), sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(methodFlow.reduce((a, b) => a + b.net, 0), sym)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>

          <Card className="p-3 mt-4">
            <div className="mb-2 text-sm font-semibold">{t('reports.party_log_heading', 'Party payment log')}</div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('sales.th_date', 'Date')}</TableHead>
                <TableHead>{t('reports.th_direction', 'Direction')}</TableHead>
                <TableHead>{t('reports.th_party', 'Party')}</TableHead>
                <TableHead>{t('reports.th_channel', 'Channel')}</TableHead>
                <TableHead>{t('reports.th_note', 'Note')}</TableHead>
                <TableHead className="text-right">{t('common.amount', 'Amount')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(partyPayments as any[]).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">{t('reports.no_party_payments', 'No party payments')}</TableCell></TableRow>}
                {(partyPayments as any[]).map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setDrill({
                      title: `${p.party_type === "customer" ? t('reports.customer_payment_title', 'Customer payment') : t('reports.supplier_payment_title', 'Supplier payment')} · ${p.customers?.name ?? p.suppliers?.name ?? "—"}`,
                      note: new Date(p.created_at).toLocaleString(),
                      cols: [t('reports.field_col', 'Field'), t('reports.value_col', 'Value')],
                      rows: [
                        [t('reports.th_direction', 'Direction'), p.party_type === "customer" ? t('reports.direction_in', 'In · from customer') : t('reports.direction_out', 'Out · to supplier')],
                        [t('reports.th_channel', 'Channel'), p.method || "—"],
                        [t('reports.th_note', 'Note'), p.note || "—"],
                        [t('common.amount', 'Amount'), fmtMoney(Number(p.amount), sym)],
                      ],
                    })}
                  >
                    <TableCell className="whitespace-nowrap text-xs">{new Date(p.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      {p.party_type === "customer"
                        ? <span className="text-success font-medium">{t('reports.direction_in', 'In · from customer')}</span>
                        : <span className="text-destructive font-medium">{t('reports.direction_out', 'Out · to supplier')}</span>}
                    </TableCell>
                    <TableCell>{p.customers?.name ?? p.suppliers?.name ?? "—"}</TableCell>
                    <TableCell className="capitalize">{p.method || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{p.note || "—"}</TableCell>
                    <TableCell className={`text-right font-medium ${p.party_type === "customer" ? "text-success" : "text-destructive"}`}>
                      {p.party_type === "customer" ? "+" : "−"}{fmtMoney(Number(p.amount), sym)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
        <TabsContent value="supplier">
          <SupplierWiseReport
            sales={allSales}
            saleReturns={allSaleReturns}
            currencySymbol={sym}
            onDrill={setDrill}
            search={search}
          />
        </TabsContent>
        {isPharmacy && (
          <TabsContent value="generic">
            <GenericWiseReport
              sales={allSales}
              saleReturns={allSaleReturns}
              currencySymbol={sym}
              search={search}
            />
          </TabsContent>
        )}
        <TabsContent value="rack">
          <RackWiseReport
            sales={allSales}
            saleReturns={allSaleReturns}
            currencySymbol={sym}
            search={search}
          />
        </TabsContent>
        {isPharmacy && (
          <TabsContent value="company">
            <CompanyWiseReport
              sales={allSales}
              saleReturns={allSaleReturns}
              currencySymbol={sym}
              search={search}
            />
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{drill?.title}</DialogTitle>
            {drill?.note && <DialogDescription>{drill.note}</DialogDescription>}
          </DialogHeader>
          {drill?.invoices && (
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('sales.th_invoice', 'Invoice')}</TableHead><TableHead>{t('sales.th_date', 'Date')}</TableHead><TableHead>{t('sales.th_customer', 'Customer')}</TableHead>
                <TableHead>{t('sales.th_method', 'Method')}</TableHead><TableHead className="text-right">{t('sales.th_total', 'Total')}</TableHead>
                <TableHead className="text-right">{t('sales.th_paid', 'Paid')}</TableHead><TableHead>{t('sales.th_status', 'Status')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {drill.invoices.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">{t('reports.no_invoices', 'No invoices')}</TableCell></TableRow>}
                {drill.invoices.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.invoice_no}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{new Date(s.created_at).toLocaleString()}</TableCell>
                    <TableCell>{s.customers?.name ?? t('common.walk_in', 'Walk-in')}</TableCell>
                    <TableCell className="capitalize">{displayPaymentMethod(s.payment_method)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(Number(s.total), sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(Number(s.paid), sym)}</TableCell>
                    <TableCell><Badge variant={s.status === "completed" ? "outline" : s.status === "credit" ? "secondary" : "destructive"}>{String(t(`sales.status_${s.status}`, s.status))}</Badge></TableCell>
                  </TableRow>
                ))}
                {drill.invoices.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={4}>{t('reports.drill_total_label', 'Total ({{count}})', { count: drill.invoices.length })}</TableCell>
                    <TableCell className="text-right">{fmtMoney(drill.invoices.reduce((a: number, b: any) => a + Number(b.total), 0), sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(drill.invoices.reduce((a: number, b: any) => a + Number(b.paid), 0), sym)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
          {drill?.cols && drill?.rows && (
            <Table>
              <TableHeader><TableRow>
                {drill.cols.map((c, i) => <TableHead key={c} className={i === 0 ? "" : "text-right"}>{c}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {drill.rows.length === 0 && <TableRow><TableCell colSpan={drill.cols.length} className="text-center text-muted-foreground py-6">{t('reports.no_records', 'No records')}</TableCell></TableRow>}
                {drill.rows.map((r, ri) => (
                  <TableRow key={ri}>
                    {r.map((c, ci) => <TableCell key={ci} className={ci === 0 ? "" : "text-right"}>{c}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}


function Stat({ icon: Icon, label, value, tone, onClick }: any) {
  const colors: Record<string, string> = { primary: "text-primary", success: "text-success", destructive: "text-destructive", warning: "text-warning" };
  return (
    <Card className={`p-4 ${onClick ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}`} onClick={onClick}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${colors[tone]}`}>{value}</div>
    </Card>
  );
}

function Row({ label, value, bold, muted, accent, onClick }: any) {
  return (
    <TableRow className={onClick ? "cursor-pointer hover:bg-muted/50" : ""} onClick={onClick}>
      <TableCell className={muted ? "text-muted-foreground" : ""}>{label}</TableCell>
      <TableCell className={`text-right ${bold ? "font-semibold" : ""} ${accent ? "text-primary text-lg" : ""}`}>{value}</TableCell>
    </TableRow>
  );
}
