// Offline recomputation of the reporting/dashboard RPCs.
//
// Every function here mirrors a server RPC's SQL exactly: filtered
// SUM/COUNT/GROUP BY over tables that are already mirrored locally
// (sales, sale_items, sale_returns, sale_return_items, purchases,
// expenses, party_payments, products, product_batches, shift_sessions).
// None of them re-derive business rules the server invents on the fly —
// they just run the same arithmetic client-side. This is safe in a way
// something like product_intelligence's ABC ranking or cash-flow's
// ledger reconciliation/de-dup logic is not — see the readLocalFirst
// call sites in dashboard.tsx / reports.tsx / operations.tsx for why
// each RPC was or wasn't given this treatment.

import { db } from "./db";

function isDeleted(r: any) {
  return r._deleted === 1;
}

/** Mirrors tenant_timezone()'s own fallback — store_settings.timezone,
 *  or Asia/Karachi if unset/invalid. */
export function resolveTenantTimezone(settings: any): string {
  const tz = settings?.timezone;
  if (typeof tz === "string" && tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      /* invalid zone name — fall through */
    }
  }
  return "Asia/Karachi";
}

/** UTC instant -> that instant's calendar date (YYYY-MM-DD) in `tz`. */
function dateInTz(iso: string, tz: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const dd = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${dd}`;
}

export interface ReportsSummary {
  sales_total: number;
  sales_cost: number;
  sales_tax: number;
  sales_count: number;
  returns_total: number;
  returns_cost: number;
  returns_count: number;
  purchases_total: number;
  incentive_total: number;
  expenses_total: number;
  party_payments_in: number;
  party_payments_out: number;
  credit_sales_total: number;
  cash_sales_total: number;
  discount_total: number;
  supplier_discount_total: number;
  timezone: string;
}

/** Mirrors get_reports_summary(p_from_date, p_to_date) exactly. */
export async function computeLocalReportsSummary(
  fromISO: string,
  toISO: string,
  timezone: string,
): Promise<ReportsSummary> {
  const sales = (await db().sales.where("created_at").between(fromISO, toISO, true, true).toArray()).filter(
    (r: any) => !isDeleted(r) && r.status !== "voided",
  );
  const returns = (await db().sale_returns.where("created_at").between(fromISO, toISO, true, true).toArray()).filter(
    (r: any) => !isDeleted(r),
  );
  const purchases = (await db().purchases.where("created_at").between(fromISO, toISO, true, true).toArray()).filter(
    (r: any) => !isDeleted(r),
  );
  const partyPayments = (await db().party_payments.where("created_at").between(fromISO, toISO, true, true).toArray()).filter(
    (r: any) => !isDeleted(r),
  );

  const fromDate = dateInTz(fromISO, timezone);
  const toDate = dateInTz(toISO, timezone);
  const allExpenses = (await db().expenses.toArray()).filter((r: any) => !isDeleted(r));
  const expenses = allExpenses.filter((r: any) => {
    const d = String(r.expense_date ?? "").slice(0, 10);
    return d >= fromDate && d <= toDate;
  });

  const returnIds = new Set(returns.map((r: any) => r.id));
  const allReturnItems = await db().sale_return_items.toArray();
  const returnsCost = allReturnItems
    .filter((it: any) => returnIds.has(it.return_id))
    .reduce((s, it: any) => s + Number(it.qty || 0) * Number(it.cost || 0), 0);

  const sum = (rows: any[], f: (r: any) => number) => rows.reduce((s, r) => s + f(r), 0);

  return {
    sales_total: sum(sales, (r) => Number(r.total || 0)),
    sales_cost: sum(sales, (r) => Number(r.cost_total || 0)),
    sales_tax: sum(sales, (r) => Number(r.tax || 0)),
    sales_count: sales.length,
    returns_total: sum(returns, (r) => Number(r.total || 0)),
    returns_cost: returnsCost,
    returns_count: returns.length,
    purchases_total: sum(purchases, (r) => Number(r.total || 0)),
    incentive_total: sum(purchases, (r) => Number(r.incentive_amount || 0)),
    expenses_total: sum(expenses, (r) => Number(r.amount || 0)),
    party_payments_in: sum(
      partyPayments.filter((r: any) => r.party_type === "customer" && r.method !== "discount"),
      (r) => Number(r.amount || 0),
    ),
    party_payments_out: sum(
      partyPayments.filter((r: any) => r.party_type === "supplier" && r.method !== "discount"),
      (r) => Number(r.amount || 0),
    ),
    credit_sales_total: sum(
      sales.filter((r: any) => r.status === "credit"),
      (r) => Number(r.total || 0) - Number(r.paid || 0),
    ),
    cash_sales_total: sum(sales, (r) => Number(r.paid || 0)),
    discount_total: sum(
      partyPayments.filter((r: any) => r.party_type === "customer" && r.method === "discount"),
      (r) => Number(r.amount || 0),
    ),
    supplier_discount_total: sum(
      partyPayments.filter((r: any) => r.party_type === "supplier" && r.method === "discount"),
      (r) => Number(r.amount || 0),
    ),
    timezone,
  };
}

export interface TimeseriesPoint {
  bucket_date: string;
  revenue: number;
  profit: number;
  returns: number;
}

/** Mirrors get_dashboard_timeseries(p_from_date, p_to_date) — hourly buckets
 *  for a <=1 day span, daily buckets otherwise, same as the RPC. */
export async function computeLocalDashboardTimeseries(fromISO: string, toISO: string): Promise<TimeseriesPoint[]> {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  const spanDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000);

  const sales = (await db().sales.where("created_at").between(fromISO, toISO, true, true).toArray()).filter(
    (r: any) => !isDeleted(r) && r.status !== "voided",
  );
  const returns = (await db().sale_returns.where("created_at").between(fromISO, toISO, true, true).toArray()).filter(
    (r: any) => !isDeleted(r),
  );

  if (spanDays <= 1) {
    const rev = new Array(24).fill(0);
    const prof = new Array(24).fill(0);
    const ret = new Array(24).fill(0);
    for (const s of sales as any[]) {
      const h = new Date(s.created_at).getUTCHours();
      rev[h] += Number(s.total || 0);
      prof[h] += Number(s.total || 0) - Number(s.tax || 0) - Number(s.cost_total || 0);
    }
    for (const r of returns as any[]) {
      const h = new Date(r.created_at).getUTCHours();
      ret[h] += Number(r.total || 0);
    }
    return Array.from({ length: 24 }, (_, h) => ({
      bucket_date: `${String(h).padStart(2, "0")}:00`,
      revenue: rev[h],
      profit: prof[h],
      returns: ret[h],
    }));
  }

  const byDay = new Map<string, { rev: number; prof: number; ret: number }>();
  const dayKey = (iso: string) => iso.slice(0, 10);
  for (const s of sales as any[]) {
    const k = dayKey(s.created_at);
    const e = byDay.get(k) ?? { rev: 0, prof: 0, ret: 0 };
    e.rev += Number(s.total || 0);
    e.prof += Number(s.total || 0) - Number(s.tax || 0) - Number(s.cost_total || 0);
    byDay.set(k, e);
  }
  for (const r of returns as any[]) {
    const k = dayKey(r.created_at);
    const e = byDay.get(k) ?? { rev: 0, prof: 0, ret: 0 };
    e.ret += Number(r.total || 0);
    byDay.set(k, e);
  }

  const points: TimeseriesPoint[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor.getTime() <= end.getTime()) {
    const key = cursor.toISOString().slice(0, 10);
    const e = byDay.get(key) ?? { rev: 0, prof: 0, ret: 0 };
    const label = `${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    points.push({ bucket_date: label, revenue: e.rev, profit: e.prof, returns: e.ret });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}

export interface TopSellingItem {
  name: string;
  qty: number;
  total: number;
}

/** Mirrors get_top_selling_items(p_from_date, p_to_date, p_limit). */
export async function computeLocalTopSellingItems(fromISO: string, toISO: string, limit: number): Promise<TopSellingItem[]> {
  const sales = (await db().sales.where("created_at").between(fromISO, toISO, true, true).toArray()).filter(
    (r: any) => !isDeleted(r) && r.status !== "voided",
  );
  const byName = new Map<string, { qty: number; total: number }>();
  for (const s of sales as any[]) {
    const items = await db().sale_items.where("sale_id").equals(s.id).toArray();
    for (const it of items as any[]) {
      const e = byName.get(it.name) ?? { qty: 0, total: 0 };
      e.qty += Number(it.qty || 0);
      e.total += Number(it.line_total || 0);
      byName.set(it.name, e);
    }
  }
  return Array.from(byName, ([name, v]) => ({ name, qty: v.qty, total: v.total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export interface LowStockProduct {
  id: string;
  name: string;
  stock: number;
  sell_price: number;
  cost_price: number;
}

/** Mirrors get_low_stock_products(p_threshold, p_limit). */
export async function computeLocalLowStockProducts(threshold: number, limit: number): Promise<LowStockProduct[]> {
  const rows = (await db().products.toArray()).filter(
    (p: any) => !isDeleted(p) && p.is_active && Number(p.stock) <= threshold,
  );
  return rows
    .sort((a: any, b: any) => Number(a.stock) - Number(b.stock))
    .slice(0, limit)
    .map((p: any) => ({ id: p.id, name: p.name, stock: p.stock, sell_price: p.sell_price, cost_price: p.cost_price }));
}

/** Mirrors get_inventory_value(). */
export async function computeLocalInventoryValue(): Promise<number> {
  const rows = (await db().products.toArray()).filter((p: any) => !isDeleted(p) && p.is_active);
  return rows.reduce((s: number, p: any) => s + Number(p.stock || 0) * Number(p.cost_price || 0), 0);
}

// ---------------------------------------------------------------------
// operations.tsx's Owner/Calendar tabs — morning_dashboard, daily_summary,
// owner_alerts, owner_recommendations, daily_timeline. None of these take
// a tenant-timezone parameter (unlike get_reports_summary's expense-date
// bucketing) — they key off CURRENT_DATE / a client-supplied DATE, which
// Postgres evaluates in the session's (UTC, on Supabase) timezone, so the
// local versions use UTC day boundaries too, matching operations.tsx's own
// `new Date().toISOString().slice(0, 10)` "today".
// ---------------------------------------------------------------------

function utcMidnight(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/** Mirrors morning_dashboard() — yesterday's numbers (UTC calendar day). */
export async function computeLocalMorningDashboard(): Promise<any> {
  const end = utcMidnight(new Date());
  const start = new Date(end.getTime() - 86_400_000);
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const sales = (await db().sales.where("created_at").between(startISO, endISO, true, false).toArray()).filter(
    (r: any) => !isDeleted(r),
  );
  const returns = (await db().sale_returns.where("created_at").between(startISO, endISO, true, false).toArray()).filter(
    (r: any) => !isDeleted(r),
  );
  const expenses = (await db().expenses.where("created_at").between(startISO, endISO, true, false).toArray()).filter(
    (r: any) => !isDeleted(r),
  );
  const heldCount = (await db().held_bills.toArray()).filter((r: any) => !isDeleted(r) && r.status === "held").length;
  const openTasksCount = (await db().shift_tasks.toArray()).filter(
    (r: any) => !isDeleted(r) && ["open", "in_progress"].includes(r.status),
  ).length;
  const lowStockCount = (await db().products.toArray()).filter(
    (p: any) => !isDeleted(p) && p.is_active && p.min_stock != null && Number(p.stock) <= Number(p.min_stock),
  ).length;

  const salesTotal = sales.reduce((s, r: any) => s + Number(r.total || 0), 0);
  const salesCost = sales.reduce((s, r: any) => s + Number(r.cost_total || 0), 0);
  const returnsTotal = returns.reduce((s, r: any) => s + Number(r.total || 0), 0);
  const expensesTotal = expenses.reduce((s, r: any) => s + Number(r.amount || 0), 0);

  return {
    yesterday_sales_count: sales.length,
    yesterday_sales_total: salesTotal,
    yesterday_profit: salesTotal - salesCost,
    yesterday_returns: returns.length,
    yesterday_returns_total: returnsTotal,
    yesterday_expenses: expensesTotal,
    held_bills: heldCount,
    open_tasks: openTasksCount,
    low_stock_products: lowStockCount,
  };
}

/** Mirrors daily_summary(_date). */
export async function computeLocalDailySummary(dateStr: string): Promise<any> {
  const start = `${dateStr}T00:00:00.000Z`;
  const endDate = new Date(start);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = endDate.toISOString();

  const sales = (await db().sales.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));
  const returns = (await db().sale_returns.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));
  const purchases = (await db().purchases.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));
  const expenses = (await db().expenses.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));
  const shifts = (await db().shift_sessions.toArray()).filter((r: any) => !isDeleted(r) && r.business_date === dateStr);
  const notes = (await db().shift_notes.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));
  const tasks = (await db().shift_tasks.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));

  const salesTotal = sales.reduce((s, r: any) => s + Number(r.total || 0), 0);
  const salesCost = sales.reduce((s, r: any) => s + Number(r.cost_total || 0), 0);
  const salesDiscount = sales.reduce((s, r: any) => s + Number(r.discount || 0), 0);
  const returnsTotal = returns.reduce((s, r: any) => s + Number(r.total || 0), 0);
  const purchasesTotal = purchases.reduce((s, r: any) => s + Number(r.total || 0), 0);
  const expensesTotal = expenses.reduce((s, r: any) => s + Number(r.amount || 0), 0);
  const cashDiff = shifts.reduce((s, r: any) => s + Number(r.difference || 0), 0);

  return {
    date: dateStr,
    sales_count: sales.length,
    sales_total: salesTotal,
    sales_discount: salesDiscount,
    profit: salesTotal - salesCost,
    returns_count: returns.length,
    returns_total: returnsTotal,
    purchases_count: purchases.length,
    purchases_total: purchasesTotal,
    expenses_count: expenses.length,
    expenses_total: expensesTotal,
    shifts_count: shifts.length,
    cash_difference: cashDiff,
    notes_count: notes.length,
    tasks_count: tasks.length,
  };
}

/** Mirrors owner_alerts(). */
export async function computeLocalOwnerAlerts(settings: any): Promise<any[]> {
  const threshold = Number(settings?.low_stock_threshold ?? 5);
  const expireDays = Number(settings?.expiring_soon_days ?? 30);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const products = (await db().products.toArray()).filter((p: any) => !isDeleted(p) && p.is_active);
  const lowCount = products.filter((p: any) => Number(p.stock) <= Number(p.min_stock ?? threshold)).length;

  const batches = (await db().product_batches.toArray()).filter(
    (b: any) => !isDeleted(b) && Number(b.qty_remaining) > 0 && b.status === "active" && b.expiry_date,
  );
  let exSoonCount = 0;
  let exDeadCount = 0;
  for (const b of batches as any[]) {
    const days = Math.round((new Date(`${b.expiry_date}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
    if (days < 0) exDeadCount++;
    else if (days <= expireDays) exSoonCount++;
  }

  const scCount = (await db().stock_count_sessions.toArray()).filter(
    (r: any) => !isDeleted(r) && ["draft", "in_progress"].includes(r.status),
  ).length;

  const closedShifts = (await db().shift_sessions.toArray()).filter(
    (r: any) => !isDeleted(r) && r.status === "closed" && Number(r.difference ?? 0) !== 0,
  );
  const cashCount = closedShifts.length;
  const cashAmount = closedShifts.reduce((s, r: any) => s + Math.abs(Number(r.difference || 0)), 0);

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const waste = (await db().inventory_waste.where("created_at").between(weekAgo.toISOString(), new Date().toISOString(), true, true).toArray()).filter(
    (r: any) => !isDeleted(r),
  );
  const wasteValue = waste.reduce((s, r: any) => s + Number(r.total_value || 0), 0);

  const suppliers = (await db().suppliers.toArray()).filter((s: any) => !isDeleted(s) && Number(s.balance) > 0);
  const suppCount = suppliers.length;
  const suppAmount = suppliers.reduce((s, r: any) => s + Number(r.balance || 0), 0);

  return [
    { key: "low_stock", severity: lowCount > 0 ? "warn" : "ok", title: "Low stock", count: lowCount, route: "/products?filter=low" },
    { key: "near_expiry", severity: exSoonCount > 0 ? "warn" : "ok", title: "Near-expiry batches", count: exSoonCount, route: "/expiry" },
    { key: "expired", severity: exDeadCount > 0 ? "danger" : "ok", title: "Expired batches", count: exDeadCount, route: "/expiry" },
    { key: "pending_stock_count", severity: scCount > 0 ? "info" : "ok", title: "Pending stock counts", count: scCount, route: "/stock-count" },
    { key: "cash_difference", severity: cashCount > 0 ? "warn" : "ok", title: "Shifts with cash difference", count: cashCount, amount: cashAmount, route: "/shifts" },
    { key: "waste_week", severity: wasteValue > 0 ? "info" : "ok", title: "Waste value (7d)", amount: wasteValue, route: "/expiry" },
    { key: "supplier_dues", severity: suppCount > 0 ? "info" : "ok", title: "Suppliers with balance", count: suppCount, amount: suppAmount, route: "/suppliers" },
  ];
}

/** Mirrors owner_recommendations(). */
export async function computeLocalOwnerRecommendations(): Promise<any> {
  const low = (await db().products.toArray())
    .filter((p: any) => !isDeleted(p) && p.is_active && p.min_stock != null && Number(p.stock) <= Number(p.min_stock))
    .sort((a: any, b: any) => (Number(b.min_stock) - Number(b.stock)) - (Number(a.min_stock) - Number(a.stock)))
    .slice(0, 5);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in7 = new Date(today.getTime() + 7 * 86_400_000);
  const batches = (await db().product_batches.toArray()).filter(
    (b: any) => !isDeleted(b) && Number(b.qty_remaining) > 0 && b.status === "active" && b.expiry_date
      && new Date(`${b.expiry_date}T00:00:00`) < in7,
  );
  const soonestByProduct = new Map<string, string>();
  for (const b of batches as any[]) {
    const cur = soonestByProduct.get(b.product_id);
    if (!cur || b.expiry_date < cur) soonestByProduct.set(b.product_id, b.expiry_date);
  }
  const expProducts: { name: string; e: string }[] = [];
  for (const [pid, e] of soonestByProduct) {
    const p = await db().products.get(pid);
    if (p) expProducts.push({ name: p.name, e });
  }
  expProducts.sort((a, b) => a.e.localeCompare(b.e));
  const exp = expProducts.slice(0, 5);

  const suppliers = (await db().suppliers.toArray())
    .filter((s: any) => !isDeleted(s) && Number(s.balance) > 0)
    .sort((a: any, b: any) => Number(b.balance) - Number(a.balance))
    .slice(0, 5);

  const scRows = (await db().stock_count_sessions.toArray())
    .filter((r: any) => !isDeleted(r) && ["draft", "in_progress"].includes(r.status))
    .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 3);

  const cashRows = (await db().shift_sessions.toArray())
    .filter((r: any) => !isDeleted(r) && r.status === "closed" && Number(r.difference ?? 0) !== 0)
    .sort((a: any, b: any) => String(b.closed_at || "").localeCompare(String(a.closed_at || "")))
    .slice(0, 3);

  return {
    reorder: low.map((p: any) => ({ title: `Reorder ${p.name}`, detail: `Stock ${p.stock} / min ${p.min_stock}`, priority: "high" })),
    expiry: exp.map((e) => ({ title: `Check expiry: ${e.name}`, detail: `Expires ${e.e}`, priority: "high" })),
    suppliers: suppliers.map((s: any) => ({ title: `Pay supplier: ${s.name}`, detail: "Balance due", amount: s.balance, priority: "normal" })),
    stock_counts: scRows.map((r: any) => ({ title: "Complete stock count", detail: r.name ?? "Untitled", priority: "normal", id: r.id })),
    cash_diff: cashRows.map((r: any) => ({ title: "Review cash difference", detail: `${r.business_date}: ${r.difference}`, priority: "normal", id: r.id })),
  };
}

function initcap(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Mirrors daily_timeline(_date). */
export async function computeLocalDailyTimeline(dateStr: string): Promise<any[]> {
  const start = `${dateStr}T00:00:00.000Z`;
  const endDate = new Date(start);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = endDate.toISOString();
  const inWindow = (iso: string | null | undefined) => !!iso && iso >= start && iso < end;

  const events: any[] = [];

  const shifts = (await db().shift_sessions.toArray()).filter((r: any) => !isDeleted(r));
  for (const s of shifts as any[]) {
    if (inWindow(s.opened_at)) events.push({ ts: s.opened_at, kind: "shift_open", title: "Shift opened", detail: s.opening_notes ?? "", amount: s.opening_cash, user_id: s.cashier_id, ref_id: s.id });
    if (inWindow(s.closed_at)) events.push({ ts: s.closed_at, kind: "shift_close", title: "Shift closed", detail: s.closing_notes ?? "", amount: s.actual_cash, user_id: s.cashier_id, ref_id: s.id });
  }

  const sales = (await db().sales.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));
  for (const s of sales as any[]) {
    events.push({ ts: s.created_at, kind: "sale", title: s.invoice_no ? `Invoice ${s.invoice_no}` : "Sale", detail: s.payment_method, amount: s.total, user_id: s.cashier_id, ref_id: s.id });
  }

  const returns = (await db().sale_returns.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));
  for (const r of returns as any[]) {
    events.push({ ts: r.created_at, kind: "sale_return", title: "Sale return", detail: r.note ?? "", amount: r.total, user_id: r.user_id, ref_id: r.id });
  }

  const purchases = (await db().purchases.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));
  for (const p of purchases as any[]) {
    events.push({ ts: p.created_at, kind: "purchase", title: "Purchase", detail: p.note ?? "", amount: p.total, user_id: p.user_id, ref_id: p.id });
  }

  const expenses = (await db().expenses.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));
  for (const e of expenses as any[]) {
    events.push({ ts: e.created_at, kind: "expense", title: e.category ? `Expense: ${e.category}` : "Expense", detail: e.description ?? "", amount: e.amount, user_id: e.user_id, ref_id: e.id });
  }

  const cashEvents = (await db().cash_drawer_events.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));
  for (const c of cashEvents as any[]) {
    events.push({ ts: c.created_at, kind: `cash_${c.event_type}`, title: initcap(String(c.event_type).replace(/_/g, " ")), detail: c.reason ?? "", amount: c.amount, user_id: c.user_id, ref_id: c.id });
  }

  const voids = (await db().sale_voids.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));
  for (const v of voids as any[]) {
    events.push({ ts: v.created_at, kind: "void", title: `Void: ${v.invoice_no ?? ""}`, detail: v.reason, amount: v.original_total, user_id: v.voided_by, ref_id: v.id });
  }

  const reprints = (await db().receipt_reprints.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));
  for (const rp of reprints as any[]) {
    events.push({ ts: rp.created_at, kind: "reprint", title: "Receipt reprint", detail: rp.reason ?? "", amount: null, user_id: rp.user_id, ref_id: rp.id });
  }

  const notes = (await db().shift_notes.where("created_at").between(start, end, true, false).toArray()).filter((r: any) => !isDeleted(r));
  for (const n of notes as any[]) {
    events.push({ ts: n.created_at, kind: "note", title: `Shift note (${n.category})`, detail: n.note, amount: null, user_id: n.user_id, ref_id: n.id });
  }

  events.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  return events;
}
