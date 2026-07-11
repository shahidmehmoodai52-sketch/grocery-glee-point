import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Tables → query keys to invalidate when any row changes anywhere in the system.
const MAP: Record<string, string[][]> = {
  products: [["products"], ["products", "active"], ["dash-products"]],
  product_barcodes: [["product_barcodes"]],
  sales: [["sales"], ["dash-sales"]],
  sale_items: [["sales"], ["dash-top-items"]],
  purchases: [["purchases"], ["dash-purchases"]],
  purchase_items: [["purchases"]],
  sale_returns: [["sale-returns"], ["dash-sale-returns"]],
  sale_return_items: [["sale-returns"]],
  purchase_returns: [["purchase-returns"]],
  purchase_return_items: [["purchase-returns"]],
  customers: [["customers"]],
  suppliers: [["suppliers"]],
  expenses: [["expenses"]],
  party_payments: [["party_payments"], ["customers"], ["suppliers"]],
  inventory_movements: [["product-movements"], ["product-health"]],
  product_batches: [["batches-status"]],
  inventory_damages: [["damage-log"], ["expiry-reports"]],
  inventory_waste: [["waste-log"], ["expiry-reports"]],
  tenants: [["library-access-prefs"], ["tenant-price-visibility"], ["my-access"]],
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
