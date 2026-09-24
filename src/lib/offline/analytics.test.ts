// Exercises the offline-recomputation functions (analytics.ts, shifts.ts)
// against a real (fake) IndexedDB, so their arithmetic is checked the same
// way it will actually run in the browser — through Dexie, not by calling
// the pure function in isolation with hand-built inputs.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, MIRRORED_TABLES } from "./db";
import {
  computeLocalReportsSummary,
  computeLocalDashboardTimeseries,
  computeLocalTopSellingItems,
  computeLocalLowStockProducts,
  computeLocalInventoryValue,
  computeLocalMorningDashboard,
  computeLocalDailySummary,
  computeLocalOwnerAlerts,
  computeLocalOwnerRecommendations,
  computeLocalDailyTimeline,
  resolveTenantTimezone,
} from "./analytics";
import { computeLocalShiftReport } from "./shifts";

const TENANT = "tenant-1";

async function wipeAll() {
  for (const t of MIRRORED_TABLES) {
    try {
      await (db() as any)[t].clear();
    } catch {
      /* table may not exist in this Dexie version's typed surface — fine */
    }
  }
}

beforeEach(async () => {
  await wipeAll();
});

describe("resolveTenantTimezone", () => {
  it("uses store_settings.timezone when set", () => {
    expect(resolveTenantTimezone({ timezone: "Asia/Karachi" })).toBe("Asia/Karachi");
  });
  it("falls back to Asia/Karachi when unset", () => {
    expect(resolveTenantTimezone({})).toBe("Asia/Karachi");
  });
  it("falls back to Asia/Karachi for an invalid zone name", () => {
    expect(resolveTenantTimezone({ timezone: "Not/AZone" })).toBe("Asia/Karachi");
  });
});

describe("computeLocalReportsSummary", () => {
  it("mirrors get_reports_summary's SUM/COUNT math over the local mirror", async () => {
    await db().sales.bulkPut([
      { id: "s1", tenant_id: TENANT, total: 1000, cost_total: 600, tax: 50, discount: 0, paid: 1000, status: "completed", created_at: "2026-01-05T10:00:00.000Z", _deleted: 0 },
      { id: "s2", tenant_id: TENANT, total: 500, cost_total: 300, tax: 0, discount: 20, paid: 200, status: "credit", created_at: "2026-01-05T12:00:00.000Z", _deleted: 0 },
      // Outside the window — must not be counted.
      { id: "s3", tenant_id: TENANT, total: 9999, cost_total: 0, tax: 0, discount: 0, paid: 9999, status: "completed", created_at: "2026-02-01T00:00:00.000Z", _deleted: 0 },
      // Voided — excluded by get_reports_summary's own `status <> 'voided'`.
      { id: "s4", tenant_id: TENANT, total: 9999, cost_total: 0, tax: 0, discount: 0, paid: 9999, status: "voided", created_at: "2026-01-05T13:00:00.000Z", _deleted: 0 },
    ] as any);
    await db().sale_returns.bulkPut([
      { id: "r1", tenant_id: TENANT, total: 100, created_at: "2026-01-05T11:00:00.000Z", _deleted: 0 },
    ] as any);
    await db().sale_return_items.bulkPut([
      { id: "ri1", return_id: "r1", qty: 2, cost: 30, _deleted: 0 },
    ] as any);
    await db().purchases.bulkPut([
      { id: "p1", tenant_id: TENANT, total: 400, incentive_amount: 10, created_at: "2026-01-05T09:00:00.000Z", _deleted: 0 },
    ] as any);
    await db().expenses.bulkPut([
      { id: "e1", tenant_id: TENANT, amount: 50, expense_date: "2026-01-05", _deleted: 0 },
    ] as any);
    await db().party_payments.bulkPut([
      { id: "pp1", party_type: "customer", method: "cash", amount: 200, created_at: "2026-01-05T10:30:00.000Z", _deleted: 0 },
      { id: "pp2", party_type: "supplier", method: "cash", amount: 80, created_at: "2026-01-05T10:30:00.000Z", _deleted: 0 },
      { id: "pp3", party_type: "customer", method: "discount", amount: 15, created_at: "2026-01-05T10:30:00.000Z", _deleted: 0 },
    ] as any);

    const summary = await computeLocalReportsSummary("2026-01-05T00:00:00.000Z", "2026-01-05T23:59:59.999Z", "UTC");

    expect(summary.sales_count).toBe(2);
    expect(summary.sales_total).toBe(1500);
    expect(summary.sales_cost).toBe(900);
    expect(summary.sales_tax).toBe(50);
    expect(summary.returns_count).toBe(1);
    expect(summary.returns_total).toBe(100);
    expect(summary.returns_cost).toBe(60); // 2 * 30
    expect(summary.purchases_total).toBe(400);
    expect(summary.incentive_total).toBe(10);
    expect(summary.expenses_total).toBe(50);
    expect(summary.party_payments_in).toBe(200);
    expect(summary.party_payments_out).toBe(80);
    expect(summary.discount_total).toBe(15);
    // credit sale s2: total 500 - paid 200 = 300 outstanding.
    expect(summary.credit_sales_total).toBe(300);
    expect(summary.cash_sales_total).toBe(1200); // 1000 + 200 paid
  });
});

describe("computeLocalDashboardTimeseries", () => {
  it("buckets by day once the span exceeds a calendar day (mirrors the RPC's extract(day from interval) floor)", async () => {
    // A Jan 1 00:00 -> Jan 2 23:59:59.999 range is only 1.999.. days, which
    // both the SQL (`extract(day from p_to-p_from)::int`) and this port
    // floor to 1 — still the hourly branch. Use a 3-day span so the floored
    // value is unambiguously > 1, exercising the daily-bucket branch.
    await db().sales.bulkPut([
      { id: "s1", total: 100, tax: 5, cost_total: 50, status: "completed", created_at: "2026-01-01T05:00:00.000Z", _deleted: 0 },
      { id: "s2", total: 200, tax: 10, cost_total: 90, status: "completed", created_at: "2026-01-02T05:00:00.000Z", _deleted: 0 },
      { id: "s3", total: 50, tax: 0, cost_total: 20, status: "voided", created_at: "2026-01-02T06:00:00.000Z", _deleted: 0 },
    ] as any);
    const points = await computeLocalDashboardTimeseries("2026-01-01T00:00:00.000Z", "2026-01-03T23:59:59.999Z");
    const byLabel = new Map(points.map((p) => [p.bucket_date, p]));
    expect(byLabel.get("01-01")?.revenue).toBe(100);
    expect(byLabel.get("01-01")?.profit).toBe(45); // 100 - 5 - 50
    expect(byLabel.get("01-02")?.revenue).toBe(200); // voided sale excluded
  });

  it("buckets by hour when the span is a single day", async () => {
    await db().sales.bulkPut([
      { id: "s1", total: 100, tax: 0, cost_total: 0, status: "completed", created_at: "2026-01-01T09:30:00.000Z", _deleted: 0 },
      { id: "s2", total: 40, tax: 0, cost_total: 0, status: "completed", created_at: "2026-01-01T09:45:00.000Z", _deleted: 0 },
    ] as any);
    const points = await computeLocalDashboardTimeseries("2026-01-01T00:00:00.000Z", "2026-01-01T23:59:59.999Z");
    expect(points).toHaveLength(24);
    const hour9 = points.find((p) => p.bucket_date === "09:00");
    expect(hour9?.revenue).toBe(140);
  });
});

describe("computeLocalTopSellingItems", () => {
  it("aggregates sale_items by name across sales in range", async () => {
    await db().sales.bulkPut([
      { id: "s1", status: "completed", created_at: "2026-01-05T10:00:00.000Z", _deleted: 0 },
      { id: "s2", status: "completed", created_at: "2026-01-05T11:00:00.000Z", _deleted: 0 },
    ] as any);
    await db().sale_items.bulkPut([
      { id: "i1", sale_id: "s1", name: "Milk 1L", qty: 2, line_total: 200 },
      { id: "i2", sale_id: "s2", name: "Milk 1L", qty: 1, line_total: 100 },
      { id: "i3", sale_id: "s2", name: "Bread", qty: 3, line_total: 90 },
    ] as any);
    const top = await computeLocalTopSellingItems("2026-01-05T00:00:00.000Z", "2026-01-05T23:59:59.999Z", 6);
    expect(top[0]).toMatchObject({ name: "Milk 1L", qty: 3, total: 300 });
    expect(top[1]).toMatchObject({ name: "Bread", qty: 3, total: 90 });
  });
});

describe("computeLocalLowStockProducts / computeLocalInventoryValue", () => {
  it("finds active products at or below stock threshold, sorted ascending", async () => {
    await db().products.bulkPut([
      { id: "p1", name: "A", is_active: true, stock: 2, cost_price: 10, sell_price: 20, _deleted: 0 },
      { id: "p2", name: "B", is_active: true, stock: 50, cost_price: 5, sell_price: 8, _deleted: 0 },
      { id: "p3", name: "C", is_active: true, stock: 0, cost_price: 3, sell_price: 6, _deleted: 0 },
      { id: "p4", name: "D", is_active: false, stock: 1, cost_price: 1, sell_price: 2, _deleted: 0 },
    ] as any);
    const low = await computeLocalLowStockProducts(5, 10);
    expect(low.map((p) => p.id)).toEqual(["p3", "p1"]);

    const value = await computeLocalInventoryValue();
    expect(value).toBe(2 * 10 + 50 * 5 + 0 * 3); // p4 excluded (inactive)
  });
});

describe("computeLocalMorningDashboard", () => {
  it("aggregates yesterday's UTC-day window", async () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(12, 0, 0, 0);

    await db().sales.bulkPut([
      { id: "s1", total: 500, cost_total: 200, status: "completed", created_at: yesterday.toISOString(), _deleted: 0 },
    ] as any);
    await db().held_bills.bulkPut([{ id: "h1", status: "held", _deleted: 0 }] as any);
    await db().shift_tasks.bulkPut([{ id: "t1", status: "open", _deleted: 0 }] as any);
    await db().products.bulkPut([
      { id: "p1", is_active: true, stock: 1, min_stock: 5, _deleted: 0 },
    ] as any);

    const result = await computeLocalMorningDashboard();
    expect(result.yesterday_sales_count).toBe(1);
    expect(result.yesterday_sales_total).toBe(500);
    expect(result.yesterday_profit).toBe(300);
    expect(result.held_bills).toBe(1);
    expect(result.open_tasks).toBe(1);
    expect(result.low_stock_products).toBe(1);
  });
});

describe("computeLocalDailySummary", () => {
  it("aggregates one calendar day across sales/returns/purchases/expenses/shifts", async () => {
    await db().sales.bulkPut([
      { id: "s1", total: 300, cost_total: 100, discount: 10, created_at: "2026-03-10T08:00:00.000Z", _deleted: 0 },
    ] as any);
    await db().shift_sessions.bulkPut([
      { id: "sh1", business_date: "2026-03-10", difference: -15, _deleted: 0 },
    ] as any);
    const summary = await computeLocalDailySummary("2026-03-10");
    expect(summary.sales_count).toBe(1);
    expect(summary.sales_total).toBe(300);
    expect(summary.profit).toBe(200);
    expect(summary.shifts_count).toBe(1);
    expect(summary.cash_difference).toBe(-15);
  });
});

describe("computeLocalOwnerAlerts", () => {
  it("flags low stock, near-expiry/expired batches, and cash differences", async () => {
    await db().products.bulkPut([
      { id: "p1", is_active: true, stock: 1, min_stock: 5, _deleted: 0 },
    ] as any);
    const today = new Date();
    const in5 = new Date(today.getTime() + 5 * 86_400_000).toISOString().slice(0, 10);
    const past = new Date(today.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
    await db().product_batches.bulkPut([
      { id: "b1", product_id: "p1", qty_remaining: 3, status: "active", expiry_date: in5, _deleted: 0 },
      { id: "b2", product_id: "p1", qty_remaining: 3, status: "active", expiry_date: past, _deleted: 0 },
    ] as any);
    await db().shift_sessions.bulkPut([
      { id: "sh1", status: "closed", difference: 25, _deleted: 0 },
    ] as any);
    await db().suppliers.bulkPut([
      { id: "sup1", name: "Acme", balance: 500, _deleted: 0 },
    ] as any);

    const alerts = await computeLocalOwnerAlerts({ low_stock_threshold: 5, expiring_soon_days: 30 });
    const byKey = new Map(alerts.map((a: any) => [a.key, a]));
    expect(byKey.get("low_stock")?.count).toBe(1);
    expect(byKey.get("near_expiry")?.count).toBe(1);
    expect(byKey.get("expired")?.count).toBe(1);
    expect(byKey.get("cash_difference")?.count).toBe(1);
    expect(byKey.get("cash_difference")?.amount).toBe(25);
    expect(byKey.get("supplier_dues")?.count).toBe(1);
  });
});

describe("computeLocalOwnerRecommendations", () => {
  it("lists reorder/expiry/supplier suggestions", async () => {
    await db().products.bulkPut([
      { id: "p1", name: "Rice", is_active: true, stock: 2, min_stock: 10, _deleted: 0 },
    ] as any);
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await db().product_batches.bulkPut([
      { id: "b1", product_id: "p1", qty_remaining: 5, status: "active", expiry_date: soon, _deleted: 0 },
    ] as any);
    await db().suppliers.bulkPut([{ id: "sup1", name: "Acme", balance: 300, _deleted: 0 }] as any);

    const recs = await computeLocalOwnerRecommendations();
    expect(recs.reorder[0].title).toContain("Rice");
    expect(recs.expiry[0].title).toContain("Rice");
    expect(recs.suppliers[0].title).toContain("Acme");
  });
});

describe("computeLocalDailyTimeline", () => {
  it("merges every event kind for the day, newest first", async () => {
    await db().sales.bulkPut([
      { id: "s1", invoice_no: "INV-1", total: 100, payment_method: "cash", cashier_id: "u1", created_at: "2026-04-01T08:00:00.000Z", _deleted: 0 },
    ] as any);
    await db().cash_drawer_events.bulkPut([
      { id: "c1", event_type: "paid_in", amount: 50, reason: "float", user_id: "u1", created_at: "2026-04-01T09:00:00.000Z", _deleted: 0 },
    ] as any);
    await db().shift_notes.bulkPut([
      { id: "n1", category: "general", note: "opened early", user_id: "u1", created_at: "2026-04-01T07:00:00.000Z", _deleted: 0 },
    ] as any);

    const events = await computeLocalDailyTimeline("2026-04-01");
    expect(events).toHaveLength(3);
    expect(events[0].kind).toBe("cash_paid_in"); // latest ts first
    expect(events.some((e: any) => e.kind === "sale")).toBe(true);
    expect(events.some((e: any) => e.kind === "note")).toBe(true);
  });
});

describe("computeLocalShiftReport", () => {
  it("mirrors shift_report()'s cash-summary math for one cashier's window", async () => {
    const shift = { cashier_id: "u1", opening_cash: 1000, opened_at: "2026-05-01T08:00:00.000Z", closed_at: null };
    await db().sales.bulkPut([
      { id: "s1", cashier_id: "u1", total: 500, discount: 0, tax: 0, cost_total: 200, paid: 500, payment_method: "cash", status: "completed", created_at: "2026-05-01T09:00:00.000Z", _deleted: 0 },
      { id: "s2", cashier_id: "u1", total: 300, discount: 0, tax: 0, cost_total: 100, paid: 300, payment_method: "card", status: "completed", created_at: "2026-05-01T09:30:00.000Z", _deleted: 0 },
      // Different cashier — must not be included.
      { id: "s3", cashier_id: "u2", total: 9999, discount: 0, tax: 0, cost_total: 0, paid: 9999, payment_method: "cash", status: "completed", created_at: "2026-05-01T09:30:00.000Z", _deleted: 0 },
    ] as any);
    await db().sale_returns.bulkPut([
      { id: "r1", user_id: "u1", total: 50, refund_amount: 50, refund_method: "cash", created_at: "2026-05-01T10:00:00.000Z", _deleted: 0 },
    ] as any);
    await db().expenses.bulkPut([
      { id: "e1", user_id: "u1", amount: 40, method: "cash", created_at: "2026-05-01T10:30:00.000Z", _deleted: 0 },
    ] as any);

    const report = await computeLocalShiftReport(shift);
    expect(report.sales.receipt_count).toBe(2);
    expect(report.sales.cash_in).toBe(500);
    expect(report.sales.card_in).toBe(300);
    expect(report.returns.cash_out_refund).toBe(50);
    expect(report.expenses.cash_out_expense).toBe(40);
    // opening 1000 + cash_in 500 - refund 50 - expense 40 = 1410
    expect(report.cash_summary.expected_cash).toBe(1410);
  });
});
