import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, TrendingUp, TrendingDown, Wallet, Eye, CalendarIcon, Package, Search, ArrowUpDown } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { PRESETS, rangeFor, type DatePreset } from "@/lib/date-presets";
import { useEarliestDataDate } from "@/lib/earliest-date";
import { NeedsInternetBanner } from "@/components/needs-internet-banner";
import { fetchAll } from "@/lib/supabase-page";


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
        const sName = suppliers.find((x) => x.id === sid)?.name || (sid === "unassigned" ? "Unassigned" : "Unknown");

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
            <Label className="text-xs mb-1 block">Filter by Company / Supplier</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value)}
            >
              <option value="all">Choose a company…</option>
              {Array.from(stats.values())
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.products.size} items)</option>
                ))}
            </select>
          </div>
          {selectedData && (
            <div className="flex gap-4">
              <StatMini label="Products Sold" value={selectedData.products.size} />
              <StatMini label="Total Qty" value={selectedData.qty} />
              <StatMini label="Invoices" value={selectedData.invoices.size} />
              <StatMini label="Total Sales" value={fmtMoney(selectedData.revenue, currencySymbol)} tone="success" />
            </div>
          )}
        </div>
      </Card>

      {!selectedData ? (
        <Card className="p-12 text-center text-muted-foreground border-dashed">
          <div className="flex flex-col items-center gap-2">
            <Package className="h-10 w-10 opacity-20" />
            <p>Select a company to view the sales breakdown</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-3">
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="font-semibold text-sm">Product-wise Breakdown</h3>
                <div className="text-xs text-muted-foreground">Sorted by {sortBy === "qty" ? "Quantity" : "Sale Amount"}</div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">
                      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("qty")}>
                        Qty Sold
                        <ArrowUpDown className={`h-3 w-3 ${sortBy === "qty" ? "opacity-100" : "opacity-30"}`} />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("revenue")}>
                        Total Sale
                        <ArrowUpDown className={`h-3 w-3 ${sortBy === "revenue" ? "opacity-100" : "opacity-30"}`} />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productList.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No products found</TableCell></TableRow>}
                  {productList.map((p) => (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => onDrill({
                        title: p.name,
                        note: `${p.category} · Qty ${p.qty} · Current Stock ${p.stock} · Total Sales ${fmtMoney(p.revenue, currencySymbol)}`,
                        cols: ["Field", "Value"],
                        rows: [
                          ["Category", p.category],
                          ["Quantity Sold", p.qty],
                          ["Total Sale Amount", fmtMoney(p.revenue, currencySymbol)],
                          ["Average Sale Price", fmtMoney(p.qty > 0 ? p.revenue / p.qty : 0, currencySymbol)],
                          ["Number of Invoices", p.invoices.size],
                          ["Current Stock", p.stock],
                          ["Stock Value (Cost)", fmtMoney(p.stock * p.cost, currencySymbol)],
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
                Top Selling Products
              </h3>
              <div className="space-y-4">
                {productList.slice(0, 5).map((p, idx) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground">{p.qty} sold · {((p.revenue / selectedData.revenue) * 100).toFixed(1)}% of total</div>
                    </div>
                    <div className="text-sm font-semibold">{fmtMoney(p.revenue, currencySymbol)}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold text-sm mb-4">Summary</h3>
              <div className="space-y-3">
                <SummaryRow label="Supplier Sales" value={fmtMoney(selectedData.revenue, currencySymbol)} />
                <SummaryRow label="Total Invoices" value={selectedData.invoices.size} />
                <SummaryRow label="Items Sold" value={selectedData.qty} />
                <SummaryRow label="Avg. Order Value" value={fmtMoney(selectedData.invoices.size > 0 ? selectedData.revenue / selectedData.invoices.size : 0, currencySymbol)} />
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
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
const toISO = (d: Date) => {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};

function Page() {
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
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

  const presetLabel = preset === "custom" ? "Custom range" : (PRESETS.find(p => p.key === preset)?.label ?? "Today");

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
    queryKey: ["report-sales-paged", fromTime, toTime, salesPage],
    queryFn: async () => {
      const q = supabase.from("sales")
        .select("id,invoice_no,subtotal,tax,discount,total,cost_total,paid,status,created_at,payment_method,customers(name),sale_items(name,qty,price,cost,line_total,product_id)", { count: "exact" })
        .gte("created_at", fromTime)
        .lte("created_at", toTime)
        .order("created_at", { ascending: false })
        .range(salesPage * PAGE_SIZE, (salesPage + 1) * PAGE_SIZE - 1);
      
      const { data, count, error } = await q;
      if (error) throw error;
      return { data: data || [], count: count || 0 };
    },
  });
  const sales = salesPaged.data;

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
        .gte("expense_date", from)
        .lte("expense_date", to)
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
      const base = supabase.from("party_payments")
        .select("id,party_type,amount,method,note,created_at,customers(name),suppliers(name)")
        .gte("created_at", fromTime)
        .lte("created_at", toTime)
        .order("created_at", { ascending: false });
      return await fetchAll<any>((fIdx: number, tIdx: number) => base.range(fIdx, tIdx), 1000);
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
  const netProfit = grossProfit - expensesPeriod;
  const grossRevenue = revenue + Number(summaryStats.returns_total || 0);
  const creditOut = 0; // Not in RPC yet
  const cashIn = 0; // Not in RPC yet
  const returnsLoss = Number(summaryStats.returns_total || 0);
  const returnsSubtotal = returnsLoss;

  // ---- drill-down helpers (every report row is clickable)
  const openInvoices = (title: string, list: any[], note?: string) =>
    setDrill({ title, note: note ?? `${salesPaged.count} invoice${salesPaged.count === 1 ? "" : "s"} total`, invoices: list });


  const openReturns = (title: string) =>
    setDrill({
      title,
      note: `${saleReturnsPaged.count} return${saleReturnsPaged.count === 1 ? "" : "s"}`,
      cols: ["Return #", "Date", "Customer", "Subtotal", "Refund", "Total"],
      rows: (saleReturns as any[]).map((r) => [
        r.return_no ?? "—",
        new Date(r.created_at).toLocaleString(),
        r.customers?.name ?? "Walk-in",
        fmtMoney(Number(r.subtotal ?? 0), sym),
        fmtMoney(Number(r.refund_amount ?? 0), sym),
        fmtMoney(Number(r.total ?? 0), sym),
      ]),
    });

  const openExpenses = () =>
    setDrill({
      title: "Operating expenses",
      note: `${expensesPaged.count} entr${expensesPaged.count === 1 ? "y" : "ies"} · ${fmtMoney(expensesPeriod, sym)}`,
      cols: ["Date", "Category", "Amount"],
      rows: (expenses as any[]).map((e) => [e.expense_date, e.category ?? "—", fmtMoney(Number(e.amount), sym)]),
    });

  const openPurchases = () =>
    setDrill({
      title: "Purchases (period)",
      note: `${purchasesPaged.count} purchase${purchasesPaged.count === 1 ? "" : "s"} · ${fmtMoney(totalPurchases, sym)}`,
      cols: ["Date", "Subtotal", "Tax", "Total", "Paid"],
      rows: (purchases as any[]).map((p) => [
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
    for (const s of sales as any[]) {
      const d = new Date(s.created_at).toISOString().slice(0, 10);
      const rev = Number(s.subtotal) - Number(s.discount);
      const profit = rev - Number(s.cost_total);
      const qty = (s.sale_items ?? []).reduce((a: number, i: any) => a + Number(i.qty), 0);
      const cur = map.get(d) ?? { date: d, invoices: 0, qty: 0, revenue: 0, tax: 0, total: 0, profit: 0 };
      cur.invoices += 1; cur.qty += qty; cur.revenue += rev; cur.tax += Number(s.tax); cur.total += Number(s.total); cur.profit += profit;
      map.set(d, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [sales]);

  // Product-wise
  const productSales = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number; cost: number; profit: number }>();
    for (const s of sales as any[]) {
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
    for (const r of saleReturns as any[]) {
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
  }, [sales, saleReturns]);

  // Payment method breakdown
  const paymentBreakdown = useMemo(() => {
    const map = new Map<string, { method: string; invoices: number; total: number; paid: number }>();
    for (const s of sales as any[]) {
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
  }, [sales]);

  // Combined method cash-flow: money IN (sales + customer party-payments) vs money OUT (supplier party-payments)
  const methodFlow = useMemo(() => {
    const map = new Map<string, { method: string; in_sales: number; in_customer: number; out_supplier: number; net: number }>();
    const get = (m: string) => {
      const cur = map.get(m) ?? { method: m, in_sales: 0, in_customer: 0, out_supplier: 0, net: 0 };
      map.set(m, cur); return cur;
    };
    for (const s of sales as any[]) {
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
  }, [sales, partyPayments]);

  const q = search.trim().toLowerCase();
  const filteredInvoices = useMemo(() => {
    if (!q) return sales as any[];
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
      <NeedsInternetBanner section="Reports" />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Sales, profit, invoice &amp; product breakdowns · {presetLabel}
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
          {salesLoading && <Badge variant="outline" className="animate-pulse">Loading...</Badge>}
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" /> Print</Button>
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
                : "Custom range"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              selected={{ from: fromDate, to: toDate }}
              onSelect={(r) => {
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


      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={TrendingUp} label="Revenue" value={fmtMoney(revenue, sym)} tone="primary" />
        <Stat icon={TrendingDown} label="Cost of goods" value={fmtMoney(cogs, sym)} tone="destructive" />
        <Stat icon={Wallet} label="Gross profit" value={fmtMoney(grossProfit, sym)} tone="success" />
        <Stat icon={TrendingDown} label="Expenses (period)" value={fmtMoney(expensesPeriod, sym)} tone="warning" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center justify-between gap-2 flex-wrap no-print">
          <TabsList>
            <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
            <TabsTrigger value="sales">Sale report</TabsTrigger>
            <TabsTrigger value="profit">Sale &amp; profit</TabsTrigger>
            <TabsTrigger value="invoice">Invoice-wise</TabsTrigger>
            <TabsTrigger value="product">Product-wise</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="supplier">Supplier Wise</TabsTrigger>
          </TabsList>
          {(tab === "invoice" || tab === "product" || tab === "supplier") && (
            <Input
              placeholder={tab === "product" ? "Search product name…" : tab === "supplier" ? "Search supplier or product…" : "Search invoice, customer, amount…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 max-w-xs"
            />
          )}
        </div>

        <TabsContent value="pnl">
          <Card className="p-5">
            <h2 className="font-semibold mb-3">Profit &amp; Loss Statement</h2>
            <Table>
              <TableBody>
                <Row label="Gross sales (before returns)" value={fmtMoney(grossRevenue, sym)} muted onClick={() => openInvoices("Gross sales (before returns)", sales as any[])} />
                <Row label="Sale returns" value={`(${fmtMoney(returnsSubtotal, sym)})`} muted onClick={() => openReturns("Sale returns")} />
                <Row label="Sales (net of returns & discount)" value={fmtMoney(revenue, sym)} onClick={() => openInvoices("Sales (net of returns & discount)", sales as any[])} />
                <Row label="Cost of goods sold" value={`(${fmtMoney(cogs, sym)})`} onClick={() => openInvoices("Cost of goods sold", sales as any[])} />
                <Row label="Gross profit" value={fmtMoney(grossProfit, sym)} bold onClick={() => openInvoices("Gross profit", sales as any[])} />
                <Row label="Operating expenses" value={`(${fmtMoney(expensesPeriod, sym)})`} onClick={openExpenses} />
                <Row label="Tax collected" value={fmtMoney(taxCollected, sym)} muted onClick={() => openInvoices("Tax collected", (sales as any[]).filter((s) => Number(s.tax) > 0))} />
                <Row label="Credit outstanding" value={fmtMoney(creditOut, sym)} muted onClick={() => openInvoices("Credit outstanding", (sales as any[]).filter((s) => s.status === "credit" && Number(s.total) - Number(s.paid) > 0))} />
                <Row label="Total purchases (period)" value={fmtMoney(totalPurchases, sym)} muted onClick={openPurchases} />
                <Row label="Net profit" value={fmtMoney(netProfit, sym)} bold accent onClick={() => openInvoices("Net profit basis · all invoices", sales as any[])} />

              </TableBody>
            </Table>
            <div className="text-xs text-muted-foreground mt-3">{from} → {to} · {salesPaged.count} sales, {purchasesPaged.count} purchases, {expensesPaged.count} expenses</div>
          </Card>
        </TabsContent>

        <TabsContent value="sales">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Items qty</TableHead><TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Tax</TableHead><TableHead className="text-right">Total</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {dailySales.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No sales</TableCell></TableRow>}
                {dailySales.map((d) => (
                  <TableRow
                    key={d.date}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openInvoices(`Sales on ${d.date}`, (sales as any[]).filter((s) => new Date(s.created_at).toISOString().slice(0, 10) === d.date))}
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
                    <TableCell>Total</TableCell>
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
                <TableHead>Date</TableHead><TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin %</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {dailySales.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>}
                {dailySales.map((d) => {
                  const cost = d.revenue - d.profit;
                  const margin = d.revenue ? (d.profit / d.revenue) * 100 : 0;
                  return (
                    <TableRow
                      key={d.date}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openInvoices(`Sales & profit on ${d.date}`, (sales as any[]).filter((s) => new Date(s.created_at).toISOString().slice(0, 10) === d.date))}
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
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{dailySales.reduce((a, b) => a + b.invoices, 0)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(revenue, sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(cogs, sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(grossProfit, sym)}</TableCell>
                    <TableCell className="text-right">{revenue ? ((grossProfit / revenue) * 100).toFixed(1) : "0.0"}%</TableCell>
                  </TableRow>
                )}
              </TableBody>
             </Table>
             {purchasesPaged.count > PAGE_SIZE && (
               <div className="p-4 flex items-center justify-between border-t text-sm">
                 <div className="text-muted-foreground">Showing {purchasesPage * PAGE_SIZE + 1} to {Math.min((purchasesPage + 1) * PAGE_SIZE, purchasesPaged.count)} of {purchasesPaged.count} purchases</div>
                 <div className="flex gap-2">
                   <Button variant="outline" size="sm" onClick={() => setPurchasesPage(p => Math.max(0, p - 1))} disabled={purchasesPage === 0}>Previous</Button>
                   <Button variant="outline" size="sm" onClick={() => setPurchasesPage(p => p + 1)} disabled={(purchasesPage + 1) * PAGE_SIZE >= purchasesPaged.count}>Next</Button>
                 </div>
               </div>
             )}
           </Card>
        </TabsContent>

        <TabsContent value="invoice">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead>
                <TableHead>Method</TableHead><TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Profit</TableHead>
                <TableHead>Status</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredInvoices.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No invoices</TableCell></TableRow>}
                {filteredInvoices.map((s: any) => {
                  const profit = (Number(s.subtotal || 0) - Number(s.discount || 0)) - Number(s.cost_total || 0);
                  const qty = (s.sale_items as any[] ?? []).reduce((a: number, i: any) => a + Number(i.qty || 0), 0);
                  return (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-muted/50"

                      onClick={() => setDrill({
                        title: `Invoice ${s.invoice_no}`,
                        note: `${new Date(s.created_at).toLocaleString()} · ${s.customers?.name ?? "Walk-in"} · ${displayPaymentMethod(s.payment_method)} · Total ${fmtMoney(Number(s.total), sym)} · Paid ${fmtMoney(Number(s.paid), sym)}`,
                        cols: ["Item", "Qty", "Price", "Line total"],
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
                      <TableCell>{s.customers?.name ?? "Walk-in"}</TableCell>
                      <TableCell className="capitalize">{displayPaymentMethod(s.payment_method)}</TableCell>
                      <TableCell className="text-right">{qty}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(s.total, sym)}</TableCell>
                      <TableCell className="text-right text-success">{fmtMoney(profit, sym)}</TableCell>
                      <TableCell><Badge variant={s.status === "completed" ? "outline" : s.status === "credit" ? "secondary" : "destructive"}>{s.status}</Badge></TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}><Button asChild variant="ghost" size="icon"><Link to="/sales"><Eye className="h-4 w-4" /></Link></Button></TableCell>
                    </TableRow>
                  );
                })}
                {filteredInvoices.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={5}>Total ({filteredInvoices.length} invoices{q && ` of ${sales.length}`})</TableCell>
                    <TableCell className="text-right">{fmtMoney(filteredInvoices.reduce((a, b: any) => a + Number(b.total), 0), sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(filteredInvoices.reduce((a, b: any) => a + ((Number(b.subtotal) - Number(b.discount)) - Number(b.cost_total)), 0), sym)}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                )}
              </TableBody>
             </Table>
             {salesPaged.count > PAGE_SIZE && (
               <div className="p-4 flex items-center justify-between border-t text-sm">
                 <div className="text-muted-foreground">Showing {salesPage * PAGE_SIZE + 1} to {Math.min((salesPage + 1) * PAGE_SIZE, salesPaged.count)} of {salesPaged.count} invoices</div>
                 <div className="flex gap-2">
                   <Button variant="outline" size="sm" onClick={() => setSalesPage(p => Math.max(0, p - 1))} disabled={salesPage === 0}>Previous</Button>
                   <Button variant="outline" size="sm" onClick={() => setSalesPage(p => p + 1)} disabled={(salesPage + 1) * PAGE_SIZE >= salesPaged.count}>Next</Button>
                 </div>
               </div>
             )}
           </Card>
         </TabsContent>

        <TabsContent value="product">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty sold</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredProducts.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>}
                {filteredProducts.map((p, i) => {
                  const margin = p.revenue ? (p.profit / p.revenue) * 100 : 0;
                  return (
                    <TableRow
                      key={i}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        const rows: (string | number)[][] = [];
                        for (const s of sales as any[]) {
                          for (const it of (s.sale_items as any[]) ?? []) {
                            if (it.name !== p.name) continue;
                            rows.push([
                              s.invoice_no,
                              new Date(s.created_at).toLocaleString(),
                              s.customers?.name ?? "Walk-in",
                              Number(it.qty),
                              fmtMoney(Number(it.line_total), sym),
                            ]);
                          }
                        }
                        setDrill({
                          title: p.name,
                          note: `${rows.length} invoice line${rows.length === 1 ? "" : "s"} · Qty ${p.qty} · Revenue ${fmtMoney(p.revenue, sym)}`,
                          cols: ["Invoice", "Date", "Customer", "Qty", "Amount"],
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
                    <TableCell>Total ({filteredProducts.length} items{q && ` of ${productSales.length}`})</TableCell>
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
                <TableHead>Payment method</TableHead>
                <TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Total billed</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Share %</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {paymentBreakdown.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No payments</TableCell></TableRow>}
                {paymentBreakdown.map((p) => {
                  const totalPaid = paymentBreakdown.reduce((a, b) => a + b.paid, 0);
                  const share = totalPaid ? (p.paid / totalPaid) * 100 : 0;
                  return (
                    <TableRow
                      key={p.method}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openInvoices(
                        `Payments · ${p.method}`,
                        (sales as any[]).filter((s) => parsePaymentSplit(s.payment_method, Number(s.paid)).some((x) => (x.method || "unknown") === p.method)),
                        `${p.invoices} invoice${p.invoices === 1 ? "" : "s"} · Received ${fmtMoney(p.paid, sym)}`,
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
                    <TableCell>Total</TableCell>
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
              <div className="text-sm font-semibold">Money flow by payment channel</div>
              <div className="text-xs text-muted-foreground">Tracks each channel (cash, card, JazzCash, EasyPaisa…) — money received via sales & customer payments vs money paid out to suppliers.</div>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">In · Sales</TableHead>
                <TableHead className="text-right">In · Customer payments</TableHead>
                <TableHead className="text-right">Out · Supplier payments</TableHead>
                <TableHead className="text-right">Net (In − Out)</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {methodFlow.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No activity</TableCell></TableRow>}
                {methodFlow.map((m) => (
                  <TableRow
                    key={m.method}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => {
                      const rows: (string | number)[][] = [];
                      for (const s of sales as any[]) {
                        for (const split of parsePaymentSplit(s.payment_method, Number(s.paid))) {
                          if ((split.method || "unknown").toLowerCase() !== m.method) continue;
                          rows.push([new Date(s.created_at).toLocaleString(), "In · Sale", s.invoice_no, s.customers?.name ?? "Walk-in", fmtMoney(Number(split.amount), sym)]);
                        }
                      }
                      for (const p of partyPayments as any[]) {
                        if ((p.method || "unknown").toLowerCase() !== m.method) continue;
                        rows.push([
                          new Date(p.created_at).toLocaleString(),
                          p.party_type === "customer" ? "In · Customer payment" : "Out · Supplier payment",
                          p.note || "—",
                          p.customers?.name ?? p.suppliers?.name ?? "—",
                          `${p.party_type === "customer" ? "+" : "−"}${fmtMoney(Number(p.amount), sym)}`,
                        ]);
                      }
                      setDrill({
                        title: `Channel · ${m.method}`,
                        note: `${rows.length} entr${rows.length === 1 ? "y" : "ies"} · Net ${fmtMoney(m.net, sym)}`,
                        cols: ["Date", "Type", "Reference", "Party", "Amount"],
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
                    <TableCell>Total</TableCell>
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
            <div className="mb-2 text-sm font-semibold">Party payment log</div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(partyPayments as any[]).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No party payments</TableCell></TableRow>}
                {(partyPayments as any[]).map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setDrill({
                      title: `${p.party_type === "customer" ? "Customer payment" : "Supplier payment"} · ${p.customers?.name ?? p.suppliers?.name ?? "—"}`,
                      note: new Date(p.created_at).toLocaleString(),
                      cols: ["Field", "Value"],
                      rows: [
                        ["Direction", p.party_type === "customer" ? "In · from customer" : "Out · to supplier"],
                        ["Channel", p.method || "—"],
                        ["Note", p.note || "—"],
                        ["Amount", fmtMoney(Number(p.amount), sym)],
                      ],
                    })}
                  >
                    <TableCell className="whitespace-nowrap text-xs">{new Date(p.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      {p.party_type === "customer"
                        ? <span className="text-success font-medium">In · from customer</span>
                        : <span className="text-destructive font-medium">Out · to supplier</span>}
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
            sales={sales}
            saleReturns={saleReturns}
            currencySymbol={sym}
            onDrill={setDrill}
            search={search}
          />
        </TabsContent>
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
                <TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead>
                <TableHead>Method</TableHead><TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {drill.invoices.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No invoices</TableCell></TableRow>}
                {drill.invoices.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.invoice_no}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{new Date(s.created_at).toLocaleString()}</TableCell>
                    <TableCell>{s.customers?.name ?? "Walk-in"}</TableCell>
                    <TableCell className="capitalize">{displayPaymentMethod(s.payment_method)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(Number(s.total), sym)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(Number(s.paid), sym)}</TableCell>
                    <TableCell><Badge variant={s.status === "completed" ? "outline" : s.status === "credit" ? "secondary" : "destructive"}>{s.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {drill.invoices.length > 0 && (
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={4}>Total ({drill.invoices.length})</TableCell>
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
                {drill.rows.length === 0 && <TableRow><TableCell colSpan={drill.cols.length} className="text-center text-muted-foreground py-6">No records</TableCell></TableRow>}
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


function Stat({ icon: Icon, label, value, tone }: any) {
  const colors: Record<string, string> = { primary: "text-primary", success: "text-success", destructive: "text-destructive", warning: "text-warning" };
  return (
    <Card className="p-4">
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
