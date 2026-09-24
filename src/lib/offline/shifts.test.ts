// Exercises the offline shift-write path (open/close/emergency-close) end
// to end against a real (fake) IndexedDB: local row written with the
// correct status transition, and the RPC queued for replay — without
// touching the network, matching how these functions behave when a
// cashier is genuinely offline.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, MIRRORED_TABLES } from "./db";
import { setMeta } from "./device";
import { openShiftOfflineAware, closeShiftOfflineAware, emergencyCloseShiftOfflineAware } from "./shifts";

async function wipeAll() {
  for (const t of MIRRORED_TABLES) {
    try {
      await (db() as any)[t].clear();
    } catch {
      /* fine */
    }
  }
  await db()._queue.clear();
}

beforeEach(async () => {
  await wipeAll();
  vi.stubGlobal("navigator", { onLine: false });
  await setMeta("user_id", "u1");
  await setMeta("tenant_id", "tenant-1");
});

describe("openShiftOfflineAware (offline)", () => {
  it("writes a local open shift row and queues open_shift for replay", async () => {
    const { id } = await openShiftOfflineAware({
      opening_cash: 500,
      notes: "morning start",
      allowMultiple: false,
      businessDayStartHour: 0,
    });

    const row = await db().shift_sessions.get(id);
    expect(row).toBeTruthy();
    expect(row.status).toBe("open");
    expect(row.cashier_id).toBe("u1");
    expect(row.opening_cash).toBe(500);
    expect(row._offline_pending).toBe(true);

    const queued = await db()._queue.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0].table).toBe("open_shift");
    expect(queued[0].payload._opening_cash).toBe(500);
  });

  it("refuses a second open shift for the same cashier when multiple shifts aren't allowed", async () => {
    await openShiftOfflineAware({ opening_cash: 100, notes: null, allowMultiple: false, businessDayStartHour: 0 });
    await expect(
      openShiftOfflineAware({ opening_cash: 200, notes: null, allowMultiple: false, businessDayStartHour: 0 }),
    ).rejects.toThrow(/already have an open shift/i);
  });
});

describe("closeShiftOfflineAware (offline)", () => {
  it("computes expected cash from that cashier's sales/returns/expenses and queues close_shift", async () => {
    const { id: shiftId } = await openShiftOfflineAware({
      opening_cash: 1000,
      notes: null,
      allowMultiple: false,
      businessDayStartHour: 0,
    });

    const shift = await db().shift_sessions.get(shiftId);
    // computeLocalShiftReport's window end is "now" when the shift is still
    // open (no closed_at yet) — the sale must land between opened_at and the
    // real wall-clock moment closeShiftOfflineAware runs, not just after
    // opened_at, so 1ms after opened_at rather than a synthetic future offset.
    await db().sales.put({
      id: "s1", cashier_id: "u1", total: 500, discount: 0, tax: 0, cost_total: 200,
      paid: 500, payment_method: "cash", status: "completed",
      created_at: new Date(new Date(shift.opened_at).getTime() + 1).toISOString(), _deleted: 0,
    } as any);

    await closeShiftOfflineAware({
      shift_id: shiftId,
      actual_cash: 1480,
      closing_notes: "end of day",
      reason: null,
      requireManagerApproval: false,
      isAdmin: true,
    });

    const closed = await db().shift_sessions.get(shiftId);
    expect(closed.status).toBe("approved"); // admin, no approval requirement -> approved
    expect(closed.expected_cash).toBe(1500); // 1000 opening + 500 cash sale
    expect(closed.difference).toBe(-20); // 1480 actual - 1500 expected
    expect(closed.actual_cash).toBe(1480);

    const queued = await db()._queue.toArray();
    const closeItem = queued.find((q: any) => q.table === "close_shift");
    expect(closeItem).toBeTruthy();
    expect(closeItem!.payload._actual_cash).toBe(1480);
  });

  it("closes to 'closed' (not 'approved') when manager approval is required and the closer isn't admin", async () => {
    const { id: shiftId } = await openShiftOfflineAware({
      opening_cash: 0, notes: null, allowMultiple: false, businessDayStartHour: 0,
    });
    await closeShiftOfflineAware({
      shift_id: shiftId, actual_cash: 0, closing_notes: null, reason: null,
      requireManagerApproval: true, isAdmin: false,
    });
    const closed = await db().shift_sessions.get(shiftId);
    expect(closed.status).toBe("closed");
  });
});

describe("emergencyCloseShiftOfflineAware (offline)", () => {
  it("marks the shift emergency_closed with the reason and queues the RPC", async () => {
    const { id: shiftId } = await openShiftOfflineAware({
      opening_cash: 200, notes: null, allowMultiple: false, businessDayStartHour: 0,
    });
    await emergencyCloseShiftOfflineAware({ shift_id: shiftId, reason: "power outage" });

    const row = await db().shift_sessions.get(shiftId);
    expect(row.status).toBe("emergency_closed");
    expect(row.emergency_reason).toBe("power outage");
    expect(row.closed_at).toBeTruthy();

    const queued = await db()._queue.toArray();
    expect(queued.some((q: any) => q.table === "emergency_close_shift")).toBe(true);
  });
});
