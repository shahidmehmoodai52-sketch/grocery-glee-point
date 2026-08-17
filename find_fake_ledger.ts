import { supabaseAdmin } from './src/integrations/supabase/client.server';

async function audit() {
  const customerId = "ff1c91d0-df75-4c06-a694-e59b32528c9d";
  const tenantId = "1c951f0e-0219-4c9d-9bae-f3132958342d";

  console.log(`--- Item Breakdown for Customer ${customerId} (920-G) on 8/1 ---`);

  const { data: sales } = await supabaseAdmin
    .from('sales')
    .select('id, invoice_no, total')
    .eq('customer_id', customerId)
    .gte('created_at', '2026-08-01T00:00:00Z')
    .lt('created_at', '2026-08-02T00:00:00Z');

  if (sales) {
    for (const s of sales) {
      console.log(`\nInvoice: ${s.invoice_no} (ID: ${s.id}, Total: ${s.total})`);
      const { data: items } = await supabaseAdmin
        .from('sale_items')
        .select('*')
        .eq('sale_id', s.id);
      
      console.log(`Raw items data length: ${items?.length}`);
      
      if (items && items.length > 0) {
        for (const item of items) {
          const { data: product } = await supabaseAdmin
            .from('products')
            .select('name, sku')
            .eq('id', item.product_id)
            .single();
          console.log(`- ${product?.name || 'Unknown'} (ProdID: ${item.product_id}): ${item.qty} x ${item.unit_price} = ${item.total_price}`);
        }
      } else {
        console.log("- NO ITEMS RETURNED BY QUERY -");
      }
    }
  }
}

audit();
