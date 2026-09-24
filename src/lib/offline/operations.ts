// Offline-aware helpers for operations.tsx's shift-adjacent RPCs (held
// bills, cash drawer events, closing checklist) that need more than the
// generic insert/update/delete helpers in pos.ts — either because they
// look up the current shift server-side, or (resume) because the caller
// needs the held bill's payload back to hand to POS.
//
// Plain-table CRUD (shift_tasks, shift_notes, manager_handovers) doesn't
// need dedicated wrappers here — operations.tsx calls insertOfflineAware /
// updateOfflineAware directly for those, the same as assets.tsx.

import { supabase } from "@/integrations/supabase/client";
import { db } from "./db";
import { getOfflineStatus, isEffectivelyOffline } from "./status";
import { enqueueWrite } from "./sync";
import { getMeta } from "./device";

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

/** Resume a held bill: returns its cart payload for POS to load.
 *  Offline, the payload is already sitting in the local mirror (pos.tsx
 *  wrote it there when the bill was held), so no round trip is needed —
 *  only the status flip gets queued. */
export async function resumeHeldBillOfflineAware(id: string): Promise<{ offline: boolean; payload: any }> {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;

  if (!offline) {
    try {
      const { data, error } = await supabase.rpc("resume_bill" as any, { _id: id } as any);
      if (error) throw error;
      return { offline: false, payload: data };
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const bill = await db().held_bills.get(id);
  if (!bill || bill.status !== "held") throw new Error("Held bill not found");

  const now = new Date().toISOString();
  const user_id = (await getMeta<string>("user_id")) ?? null;
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;

  await db().held_bills.put({ ...bill, status: "resumed", resumed_at: now, resumed_by: user_id, _sync: "pending" });
  await enqueueWrite({ op: "rpc", table: "resume_bill", tenant_id, payload: { _id: id } });

  return { offline: true, payload: bill.payload };
}

export async function discardHeldBillOfflineAware(id: string): Promise<{ offline: boolean }> {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;

  if (!offline) {
    try {
      const { error } = await supabase.rpc("discard_held_bill" as any, { _id: id, _reason: null } as any);
      if (error) throw error;
      return { offline: false };
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const bill = await db().held_bills.get(id);
  if (!bill || bill.status !== "held") throw new Error("Held bill not found");

  const now = new Date().toISOString();
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;

  await db().held_bills.put({ ...bill, status: "discarded", discarded_at: now, _sync: "pending" });
  await enqueueWrite({ op: "rpc", table: "discard_held_bill", tenant_id, payload: { _id: id, _reason: null } });

  return { offline: true };
}

export interface CashEventPayload {
  type: string;
  amount: number;
  reason: string | null;
  reference: string | null;
}

/** Mirrors record_cash_event()'s own current-shift lookup — the RPC never
 *  takes a shift_id param, it looks up the cashier's open shift itself. */
export async function recordCashEventOfflineAware(payload: CashEventPayload): Promise<{ offline: boolean }> {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;

  const rpcPayload = {
    _type: payload.type,
    _amount: payload.amount,
    _reason: payload.reason,
    _reference: payload.reference,
  };

  if (!offline) {
    try {
      const { error } = await supabase.rpc("record_cash_event" as any, rpcPayload as any);
      if (error) throw error;
      return { offline: false };
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const user_id = (await getMeta<string>("user_id")) ?? null;
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;
  const now = new Date().toISOString();

  let shift_id: string | null = null;
  if (user_id) {
    const open = await db().shift_sessions.where("[cashier_id+status]").equals([user_id, "open"]).toArray();
    open.sort((a: any, b: any) => String(b.opened_at).localeCompare(String(a.opened_at)));
    shift_id = open[0]?.id ?? null;
  }

  await db().cash_drawer_events.put({
    id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `local-${Date.now()}`,
    tenant_id,
    shift_id,
    user_id,
    event_type: payload.type,
    amount: payload.amount,
    reason: payload.reason,
    reference: payload.reference,
    approved_by: null,
    created_at: now,
    _sync: "pending",
    _offline_pending: true,
  });

  await enqueueWrite({ op: "rpc", table: "record_cash_event", tenant_id, payload: rpcPayload });

  return { offline: true };
}

export interface ChecklistItemPayload {
  shift_id: string;
  key: string;
  label: string;
  completed: boolean;
  note: string | null;
}

export async function setChecklistItemOfflineAware(payload: ChecklistItemPayload): Promise<{ offline: boolean }> {
  const enabled = getOfflineStatus().enabled;
  const offline = isOffline() && enabled;

  const rpcPayload = {
    _shift_id: payload.shift_id,
    _key: payload.key,
    _label: payload.label,
    _completed: payload.completed,
    _note: payload.note,
  };

  if (!offline) {
    try {
      const { error } = await supabase.rpc("set_checklist_item" as any, rpcPayload as any);
      if (error) throw error;
      return { offline: false };
    } catch (e: any) {
      if (!enabled || !isNetworkError(e)) throw e;
    }
  }

  const user_id = (await getMeta<string>("user_id")) ?? null;
  const tenant_id = (await getMeta<string>("tenant_id")) ?? null;
  const now = new Date().toISOString();

  const existing = await db().shift_checklist.where("[shift_id+item_key]").equals([payload.shift_id, payload.key]).first();
  const id = existing?.id ?? ((typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `local-${Date.now()}`);

  await db().shift_checklist.put({
    id,
    tenant_id,
    shift_id: payload.shift_id,
    item_key: payload.key,
    label: payload.label,
    completed: payload.completed,
    completed_by: payload.completed ? user_id : null,
    completed_at: payload.completed ? now : null,
    note: payload.note,
    created_at: existing?.created_at ?? now,
    _sync: "pending",
    _offline_pending: true,
  });

  await enqueueWrite({ op: "rpc", table: "set_checklist_item", tenant_id, payload: rpcPayload });

  return { offline: true };
}
