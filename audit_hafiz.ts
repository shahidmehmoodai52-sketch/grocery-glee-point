
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function auditShop() {
  const shopCode = 'hafiz-super-mart-023';
  
  // 1. Find all tenants associated with this shop code (handles fragmentation)
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id, name')
    .ilike('name', `%${shopCode}%`);
    
  if (!tenants || tenants.length === 0) {
    console.log("No tenants found for shop code:", shopCode);
    // Let's broaden the search just in case
    const { data: allTenants } = await supabaseAdmin.from('tenants').select('id, name').limit(10);
    console.log("Broad search (first 10 tenants):", allTenants?.map(t => t.name));
    return;
  }
  
  const tenantIds = tenants.map(t => t.id);
  console.log("Found tenants:", tenants.map(t => `${t.name} (${t.id})`));

  // 2. Query all sales for these tenants on Aug 1st, 2026 (PKT is UTC+5 usually, let's look at the whole day)
  // User mentions 8/1/2026.
  const targetDateStart = '2026-08-01T00:00:00Z';
  const targetDateEnd = '2026-08-01T23:59:59Z';

  const { data: sales } = await supabaseAdmin
    .from('sales')
    .select(`
      id, 
      invoice_no, 
      total, 
      created_at, 
      customer_id, 
      note,
      sale_items (id, name, product_id)
    `)
    .in('tenant_id', tenantIds)
    .gte('created_at', targetDateStart)
    .lte('created_at', targetDateEnd);

  console.log(`Found ${sales?.length || 0} sales on 2026-08-01.`);

  // 3. Identify "fake" invoices (no product_id or no items)
  const anomalies = sales?.filter(s => {
    const items = s.sale_items as any[];
    const hasItems = items && items.length > 0;
    const allItemsHaveProduct = hasItems && items.every(item => item.product_id !== null);
    return !hasItems || !allItemsHaveProduct;
  });

  console.log("\n--- Anomalous Invoices (Potential 'Fake' Invoices) ---");
  anomalies?.forEach(s => {
    console.log(`Invoice: ${s.invoice_no}`);
    console.log(`  ID: ${s.id}`);
    console.log(`  Total: ${s.total}`);
    console.log(`  Created At: ${s.created_at}`);
    console.log(`  Items Count: ${(s.sale_items as any[])?.length || 0}`);
    console.log(`  Note: ${s.note || 'None'}`);
    const itemsWithoutProduct = (s.sale_items as any[])?.filter(i => !i.product_id).map(i => i.name);
    if (itemsWithoutProduct?.length) {
      console.log(`  Items without Product ID: ${itemsWithoutProduct.join(', ')}`);
    }
    console.log("-------------------------------------------------");
  });

  // 4. Also check party_payments for any manual ledger entries on that date
  const { data: payments } = await supabaseAdmin
    .from('party_payments')
    .select('id, amount, note, created_at, party_id')
    .in('tenant_id', tenantIds)
    .gte('created_at', targetDateStart)
    .lte('created_at', targetDateEnd)
    .eq('party_type', 'customer');

  console.log(`\nFound ${payments?.length || 0} customer payments on 2026-08-01.`);
  payments?.forEach(p => {
    console.log(`Payment ID: ${p.id}`);
    console.log(`  Amount: ${p.amount}`);
    console.log(`  Note: ${p.note || 'None'}`);
    console.log(`  Created At: ${p.created_at}`);
    console.log("-------------------------------------------------");
  });
}

auditShop().catch(console.error);
