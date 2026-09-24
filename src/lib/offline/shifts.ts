// Offline-aware shift session management (shifts.tsx).
//
// Online  : calls open_shift / close_shift / emergency_close_shift /
//           approve_shift exactly as before.
// Offline : writes/updates the local shift_sessions mirror with the same
//           status-transition logic the RPC applies, and queues the RPC
//           for replay — mirroring purchases.ts / expiry.ts's pattern.
//
// close_shift / emergency_close_shift need an "expected cash" figure,
// which the server computes by aggregating that cashier's sales/returns/
// expenses for the shift window (shift_report()). That aggregation is
// simple SUM/COUNT/CASE-WHEN math over already-mirrored tables, so it's
// safe to recompute locally the same way expiry.tsx recomputes
// days_remaining — it's an honest local preview, not a value that gets
// persisted as-is: the queued RPC replays through the server's own
// shift_report() when it reaches the cloud (after priority 5-71 items —
// sales, returns, expenses — for the same shift), and that server
// computation, not this local one, is what actually gets stored.

import { supabase } from "@/integrations/supabase/client";
import { db } from "./db";
import { getOfflineStatus, isEffectivelyOffline } from "./status";
import { enqueueWrite } from "./sync";
import { getDeviceId, getMeta } from "./device";

function isOffline() {
  return isEffectivelyOffline();
}

function isNetworkError(e: any): boolean {
  const msg = String(e?.message ?? e ?? "").toLowerCase();
  if (!msg) return false;
  return /failed to fetch|network(error)?|fetch failed|load failed|timeout|timed out|offline|dns|err_(internet|network|name_not_resolved|connection)|socket|aborted|econn|enotfound/.test(
    msg,
  );
}

function uuid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Mirrors business_date_of()'s logic — the tenant's configured business-day
 *  start hour shifts which calendar date "now" counts as. */
export function businessDateOf(ts: Date, startHour: number | null | undefined): string {
  const shifted = new Date(ts.getTime() - (startHour || 0) * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

export interface ShiftReport {
  sales: {
    receipt_count: number; gross: number; discount: number; tax: number; cost: number;
    cash_in: number; card_in: number; credit_outstanding: number;
  };
  returns: { return_count: number; return_total: number; cash_out_refund: number; card_out_refund: number };
  expenses: { expense_count: number; expense_total: number; cash_out_expense: number };
  cash_summary: { opening_cash: number; cash_in: number; cash_out_refund: number; cash_out_expense: number; expected_cash: number };
  profit: number;
}

/** Mirrors shift_report()'s SQL aggregation over the local mirror. See the
 *  file header for why recomputing this locally is safe. */
export async function computeLocalShiftReport(shift: {
  cashier_id: string;
  opening_cash: number;
  opened_at: string;
  closed_at: string | null;
}): Promise<ShiftReport> {
  const end = shift.closed_at ?? new Date().toISOString();
  const inWindow = (createdAt: string) => createdAt >= shift.opened_at && createdAt <= end;

  const sales = (await db().sales.where("cashier_id").equals(shift.cashier_id).toArray()).filter(
    (s: any) => s._deleted !== 1 && inWindow(s.created_at),
  );
  const returns = (await db().sale_returns.where("user_id").equals(shift.cashier_id).toArray()).filter(
    (r: any) => r._deleted !== 1 && inWindow(r.created_at),
  );
  const expenses = (await db().expenses.where("user_id").equals(shift.cashier_id).toArray()).filter(
    (e: any) => e._deleted !== 1 && inWindow(e.created_at),
  );

  const gross = sales.reduce((s, r: any) => s + Number(r.total || 0), 0);
  const discount = sales.reduce((s, r: any) => s + Number(r.discount || 0), 0);
  const tax = sales.reduce((s, r: any) => s + Number(r.tax || 0), 0);
  const cost = sales.reduce((s, r: any) => s + Number(r.cost_total || 0), 0);
  const cash_in = sales.reduce(
    (s, r: any) => s + (r.payment_method === "cash" && ["completed", "credit"].includes(r.status) ? Number(r.paid || 0) : 0),
    0,
  );
  const card_in = sales.reduce((s, r: any) => s + (r.payment_method === "card" ? Number(r.paid || 0) : 0), 0);
  const credit_outstanding = sales.reduce(
    (s, r: any) => s + (r.status === "credit" ? Math.max(Number(r.total || 0) - Number(r.paid || 0), 0) : 0),
    0,
  );

  const return_total = returns.reduce((s, r: any) => s + Number(r.total || 0), 0);
  const cash_out_refund = returns.reduce((s, r: any) => s + (r.refund_method === "cash" ? Number(r.refund_amount || 0) : 0), 0);
  const card_out_refund = returns.reduce((s, r: any) => s + (r.refund_method === "card" ? Number(r.refund_amount || 0) : 0), 0);

  const expense_total = expenses.reduce((s, r: any) => s + Number(r.amount || 0), 0);
  const cash_out_expense = expenses.reduce((s, r: any) => s + (r.method === "cash" ? Number(r.amount || 0) : 0), 0);

  const opening_cash = Number(shift.opening_cash || 0);
  const expected_cash = opening_cash + cash_in - cash_out_refund - cash_out_expense;

  return {
    sales: { receipt_count: sales.length, gross, discount, tax, cost, cash_in, card_in, credit_outstanding },
    returns: { return_count: returns.length, return_total, cash_out_refund, card_out_refund },
    expenses: { expense_count: expenses.length, expense_total, cash_out_expense },
    cash_summary: { opening_cash, cash_in, cash_out_refund, cash_out_expense, expected_cash },
    profit: gross - tax - cost,
  };
}

export interface OpenShiftPayload {
  opening_cash: number;
  notes: string | null;
  /** store_settings.ops_allow_multiple_shifts / ops_business_day_start_hour. */
  allowMultiple: boolean;
  businessDayStartHour: number;
}

export async function openShiftOfflineAware(payload: OpenShiftPayload): Promise<{ offline: boolean; id: string }> {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;

  const rpcPayload = { _opening_cash: payload.opening_cash, _notes: payload.notes || undefined };

  if (!offline) {
    try {
      const { data, error } = await supabase.rpc("open_shift" as any, rpcPayload as any);
      if (error) throw error;
      return { offline: false, id: data as string };
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const user_id = (await getMeta<string>("user_id")) ?? null;
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;
  if (!user_id) throw new Error("Not authenticated");

  if (!payload.allowMultiple) {
    const hasOpen = await db().shift_sessions.where("[cashier_id+status]").equals([user_id, "open"]).count();
    if (hasOpen > 0) {
      throw new Error("You already have an open shift. Close it before starting a new one.");
    }
  }

  const id = uuid();
  const now = new Date().toISOString();
  const device_id = getDeviceId();

  await db().shift_sessions.put({
    id,
    tenant_id,
    cashier_id: user_id,
    business_date: businessDateOf(new Date(), payload.businessDayStartHour),
    opening_cash: payload.opening_cash,
    expected_cash: null,
    actual_cash: null,
    difference: null,
    status: "open",
    opened_at: now,
    closed_at: null,
    approved_by: null,
    approved_at: null,
    close_reason: null,
    emergency_reason: null,
    opening_notes: payload.notes || null,
    closing_notes: null,
    created_at: now,
    updated_at: now,
    _sync: "pending",
    _offline_pending: true,
    _device_id: device_id,
  });

  await enqueueWrite({ op: "rpc", table: "open_shift", tenant_id, payload: rpcPayload });

  return { offline: true, id };
}

export interface CloseShiftPayload {
  shift_id: string;
  actual_cash: number;
  closing_notes: string | null;
  reason: string | null;
  requireManagerApproval: boolean;
  isAdmin: boolean;
}

export async function closeShiftOfflineAware(payload: CloseShiftPayload): Promise<{ offline: boolean }> {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;

  const rpcPayload = {
    _shift_id: payload.shift_id,
    _actual_cash: payload.actual_cash,
    _closing_notes: payload.closing_notes || undefined,
    _reason: payload.reason || undefined,
  };

  if (!offline) {
    try {
      const { error } = await supabase.rpc("close_shift" as any, rpcPayload as any);
      if (error) throw error;
      return { offline: false };
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const shift = await db().shift_sessions.get(payload.shift_id);
  if (!shift) throw new Error("Shift not found");
  if (shift.status !== "open") throw new Error("Shift is not open");

  const report = await computeLocalShiftReport(shift);
  const expected = report.cash_summary.expected_cash;
  const diff = payload.actual_cash - expected;

  const newStatus =
    payload.requireManagerApproval && !payload.isAdmin ? "closed" : payload.isAdmin ? "approved" : "closed";
  const now = new Date().toISOString();
  const user_id = (await getMeta<string>("user_id")) ?? null;
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;

  await db().shift_sessions.put({
    ...shift,
    actual_cash: payload.actual_cash,
    expected_cash: expected,
    difference: diff,
    closed_at: now,
    closing_notes: payload.closing_notes || null,
    close_reason: payload.reason || null,
    status: newStatus,
    approved_by: newStatus === "approved" ? user_id : null,
    approved_at: newStatus === "approved" ? now : null,
    updated_at: now,
    _sync: "pending",
  });

  await enqueueWrite({ op: "rpc", table: "close_shift", tenant_id, payload: rpcPayload });

  return { offline: true };
}

export interface EmergencyCloseShiftPayload {
  shift_id: string;
  reason: string;
}

export async function emergencyCloseShiftOfflineAware(payload: EmergencyCloseShiftPayload): Promise<{ offline: boolean }> {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;

  const rpcPayload = { _shift_id: payload.shift_id, _reason: payload.reason };

  if (!offline) {
    try {
      const { error } = await supabase.rpc("emergency_close_shift" as any, rpcPayload as any);
      if (error) throw error;
      return { offline: false };
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const shift = await db().shift_sessions.get(payload.shift_id);
  if (!shift) throw new Error("Shift not found");
  if (shift.status !== "open") throw new Error("Shift is not open");

  const report = await computeLocalShiftReport(shift);
  const now = new Date().toISOString();
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;

  await db().shift_sessions.put({
    ...shift,
    status: "emergency_closed",
    emergency_reason: payload.reason,
    closed_at: now,
    expected_cash: report.cash_summary.expected_cash,
    updated_at: now,
    _sync: "pending",
  });

  await enqueueWrite({ op: "rpc", table: "emergency_close_shift", tenant_id, payload: rpcPayload });

  return { offline: true };
}

export async function approveShiftOfflineAware(shiftId: string): Promise<{ offline: boolean }> {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;

  const rpcPayload = { _shift_id: shiftId };

  if (!offline) {
    try {
      const { error } = await supabase.rpc("approve_shift" as any, rpcPayload as any);
      if (error) throw error;
      return { offline: false };
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const shift = await db().shift_sessions.get(shiftId);
  if (!shift) throw new Error("Shift not found");
  if (shift.status !== "closed") throw new Error("Only closed shifts can be approved");

  const now = new Date().toISOString();
  const user_id = (await getMeta<string>("user_id")) ?? null;
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;

  await db().shift_sessions.put({
    ...shift,
    status: "approved",
    approved_by: user_id,
    approved_at: now,
    updated_at: now,
    _sync: "pending",
  });

  await enqueueWrite({ op: "rpc", table: "approve_shift", tenant_id, payload: rpcPayload });

  return { offline: true };
}
