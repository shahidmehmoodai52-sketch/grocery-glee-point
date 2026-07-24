import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Tables → query keys to invalidate when any row changes anywhere in the system.
const MAP: Record<string, string[][]> = {
  products: [
    ["products"],
    ["products", "active"],
    ["dash-products"],
    ["product-intel"],
    ["purchase-suggestions"],
    ["low-stock-alerts"],
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


export function useRealtimeSync() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase.channel("pos-live-sync");
    Object.keys(MAP).forEach((table) => {
      channel.on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table },
        () => {
          for (const key of MAP[table]) {
            qc.invalidateQueries({ queryKey: key });
          }
        },
      );
    });
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}
