import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logPerf, whenIdle } from "@/lib/offline/perf";


// Tables → query keys to invalidate when any row changes anywhere in the system.
const MAP: Record<string, string[][]> = {
  products: [
    ["products"],
    ["products", "active"],
    ["dash-products"],
    ["product-intel"],
    ["purchase-suggestions"],
    // ["low-stock-alerts"] removed from automatic realtime invalidation
    // to prevent heavy refetches during rapid inventory movement.

    ["products-picker"],
    ["stock-count-products"],
    ["report-sales-full"],
    ["report-purchases"],
    ["product-health"],
    ["morning-dashboard"],
    ["daily-summary"],
    ["owner-alerts"],
    ["owner-recommendations"],
  ],
  product_barcodes: [["product_barcodes"]],
  sales: [
    ["sales"],
    ["dash-sales"],
    ["report-sales-full"],
    ["morning-dashboard"],
    ["daily-summary"],
    ["daily-timeline"],
    ["product-intel"],
    ["purchase-suggestions"],
  ],
  sale_items: [["sales"], ["dash-top-items"], ["product-intel"], ["purchase-suggestions"]],
  purchases: [
    ["purchases"],
    ["dash-purchases"],
    ["report-purchases"],
    ["product-intel"],
    ["purchase-suggestions"],
  ],
  purchase_items: [["purchases"], ["product-intel"], ["purchase-suggestions"]],
  sale_returns: [["sale-returns"], ["dash-sale-returns"], ["report-sales-full"]],
  sale_return_items: [["sale-returns"]],
  purchase_returns: [["purchase-returns"], ["report-purchases"]],
  purchase_return_items: [["purchase-returns"]],
  customers: [["customers"]],
  suppliers: [["suppliers"], ["suppliers-picker"]],
  expenses: [["expenses"], ["report-expenses"], ["daily-summary"]],
  party_payments: [["party_payments"], ["customers"], ["suppliers"], ["report-party-payments"]],
  inventory_movements: [
    ["product-movements"],
    ["product-health"],
    ["product-intel"],
    ["products"],
  ],
  product_batches: [["batches-status"], ["expiry-reports"], ["product-intel"]],
  inventory_damages: [["damage-log"], ["expiry-reports"], ["products"], ["product-intel"]],
  inventory_waste: [["waste-log"], ["expiry-reports"], ["products"], ["product-intel"]],
  assets: [["assets"], ["assets-stock-worth"]],
  asset_categories: [["asset_categories"]],
  cash_accounts: [["cash-accounts"]],
  cash_transactions: [["cash-transactions"]],
  stock_count_sessions: [["stock-count-sessions"], ["stock-count-session"]],
  stock_count_items: [["stock-count-items"], ["stock-count-products"]],
  store_settings: [["store_settings"], ["store-settings"], ["settings"]],
  held_bills: [["held-bills"]],
  cash_drawer_events: [["cash-events"]],
  shift_tasks: [["shift-tasks"]],
  shift_notes: [["shift-notes"]],
  shift_checklist: [["checklist"]],
  shift_sessions: [["current-shift"]],
  receipt_reprints: [["reprints"]],
  sale_voids: [["voids"]],
  tenants: [
    ["library-access-prefs"],
    ["tenant-price-visibility"],
    ["my-access"],
    ["my-tenant-status"],
    ["admin-tenant-detail"],
    ["admin-tenants"],
  ],
};

// ---------------------------------------------------------------------------
// Single shared realtime channel (module scope) — StrictMode double-mounts and
// remounts of the authenticated layout previously created duplicate
// subscriptions, so every DB change fanned out N times.
// ---------------------------------------------------------------------------
let channel: ReturnType<typeof supabase.channel> | null = null;
let subscribers = 0;
const clients = new Set<QueryClient>();

let cachedTenantId: string | null | undefined;
let tenantIdPromise: Promise<string | null> | null = null;
// Bumped whenever the cache is reset (subscribers hits 0). Lets a retry
// chain still in flight from a prior mount detect it's stale and avoid
// clobbering a fresher resolution after unmount+remount.
let tenantIdGeneration = 0;

// current_tenant_id() can come back null right after login while the
// tenant_members row is still being provisioned, or on a transient network
// error — neither means the user has no tenant. Retry with backoff a
// bounded number of times before giving up, so realtime doesn't require a
// full page reload to start once the tenant becomes resolvable, but a user
// who genuinely has no tenant (e.g. a broken/removed membership) doesn't
// get polled forever for the rest of the session.
const TENANT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTenantIdWithRetry(): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { data } = await supabase.rpc("current_tenant_id");
      if (data) return data as string;
    } catch {
      // fall through to retry/give-up below
    }
    if (attempt >= TENANT_RETRY_DELAYS_MS.length) return null;
    await sleep(TENANT_RETRY_DELAYS_MS[attempt]);
  }
}

async function resolveTenantId(): Promise<string | null> {
  if (cachedTenantId !== undefined) return cachedTenantId;
  if (!tenantIdPromise) {
    const generation = tenantIdGeneration;
    tenantIdPromise = fetchTenantIdWithRetry().then((id) => {
      if (generation === tenantIdGeneration) cachedTenantId = id;
      return id;
    });
  }
  return tenantIdPromise;
}



// Changed tables are coalesced and flushed once per window, during idle time,
// so a burst of realtime events (or a reconnect replay) cannot trigger dozens
// of simultaneous refetches while the cashier is typing.
const dirty = new Set<string>();
let flushTimer: number | null = null;
const FLUSH_MS = 600;

function scheduleFlush() {
  if (typeof window === "undefined") return;
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(async () => {
    flushTimer = null;
    if (!dirty.size) return;
    const tables = Array.from(dirty);
    dirty.clear();
    await whenIdle(300);
    const keys = new Set<string>();
    for (const t of tables) for (const key of MAP[t] ?? []) keys.add(JSON.stringify(key));
    for (const qc of clients) {
      for (const k of keys) {
        // Only refetch queries currently rendered; everything else is marked
        // stale and refetches lazily on next mount.
        qc.invalidateQueries({ queryKey: JSON.parse(k), refetchType: "active" });
      }
    }
    logPerf("realtime invalidate", { tables: tables.length, keys: keys.size });
  }, FLUSH_MS);
}

export function useRealtimeSync() {
  const qc = useQueryClient();
  useEffect(() => {
    clients.add(qc);
    subscribers += 1;
    void resolveTenantId().then((tenantId) => {
      if (!tenantId) return;
      if (channel) return;
      const ch = supabase.channel("pos-live-sync");
      Object.keys(MAP).forEach((table) => {
        const filterCol = table === "tenants" ? "id" : "tenant_id";
        ch.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table, filter: `${filterCol}=eq.${tenantId}` },
          () => {
            dirty.add(table);
            scheduleFlush();
          },
        );
      });
      ch.subscribe();
      channel = ch;
    });

    // Background sync reports the tables it actually refreshed — route them
    // through the same coalesced flush instead of a blanket invalidateQueries().
    let unsubSync: (() => void) | undefined;
    void import("@/lib/offline/sync").then(({ subscribeSyncedTables }) => {
      unsubSync = subscribeSyncedTables((tables) => {
        for (const t of tables) dirty.add(t);
        scheduleFlush();
      });
    });

    return () => {
      unsubSync?.();
      clients.delete(qc);

      subscribers -= 1;
      if (subscribers <= 0) {
        subscribers = 0;
        if (flushTimer !== null) {
          window.clearTimeout(flushTimer);
          flushTimer = null;
        }
        dirty.clear();
        if (channel) {
          supabase.removeChannel(channel);
          channel = null;
        }
        cachedTenantId = undefined;
        tenantIdPromise = null;
        tenantIdGeneration += 1;
      }

    };
  }, [qc]);
}

