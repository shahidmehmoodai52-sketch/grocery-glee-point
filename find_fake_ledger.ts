import { supabaseAdmin } from './src/integrations/supabase/client.server';

async function audit() {
  const customerId = "ff1c91d0-df75-4c06-a694-e59b32528c9d";

  console.log(`--- Deep Audit for Customer 920-G (ff1c91d0) on 8/1/2026 ---`);

  const { data: sales } = await supabaseAdmin
    .from('sales')
    .select('id, invoice_no, total, created_at')
    .eq('customer_id', customerId)
    .gte('created_at', '2026-08-01T00:00:00Z')
    .lt('created_at', '2026-08-02T00:00:00Z');

  if (sales) {
    for (const s of sales) {
      console.log(`\nSale: ${s.invoice_no} (${s.id}) at ${s.created_at}`);
      const { data: items } = await supabaseAdmin
        .from('sale_items')
        .select('*')
        .eq('sale_id', s.id);
      
      if (!items || items.length === 0) {
        console.log("-> ERROR: NO ITEMS FOUND FOR THIS SALE.");
      } else {
        items.forEach(item => {
          console.log(`   Item: Product ${item.product_id}, Qty: ${item.qty}, Price: ${item.unit_price}`);
          if (!item.product_id) console.log("   !!! MISSING PRODUCT ID !!!");
        });
      }
    }
  }

  // Look for any sales for this customer on 8/3/2026 as well (S-1804 in screenshot)
  console.log(`\n--- Auditing Customer 920-G on 8/3/2026 (S-1804) ---`);
  const { data: salesAug3 } = await supabaseAdmin
    .from('sales')
    .select('id, invoice_no, total, created_at')
    .eq('customer_id', customerId)
    .gte('created_at', '2026-08-03T00:00:00Z')
    .lt('created_at', '2026-08-04T00:00:00Z');

  if (salesAug3) {
    for (const s of salesAug3) {
      console.log(`\nSale: ${s.invoice_no} (${s.id}) at ${s.created_at}`);
      const { data: items } = await supabaseAdmin
        .from('sale_items')
        .select('*')
        .eq('sale_id', s.id);
      
      if (!items || items.length === 0) {
        console.log("-> ERROR: NO ITEMS FOUND FOR THIS SALE.");
      } else {
        items.forEach(item => {
          console.log(`   Item: Product ${item.product_id}, Qty: ${item.qty}, Price: ${item.unit_price}`);
        });
      }
    }
  }
}

audit();
