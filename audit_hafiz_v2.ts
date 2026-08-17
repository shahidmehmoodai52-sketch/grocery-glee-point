
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function auditShop() {
  const shopCode = 'hafiz-super-mart-023';
  const targetDateStart = '2026-08-01T00:00:00Z';
  const targetDateEnd = '2026-08-01T23:59:59Z';

  console.log(`Auditing Shop: ${shopCode} for date 2026-08-01...`);
  
  // 1. Find all tenants that look like the shop code
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id, name')
    .or(`name.ilike.%hafiz-super-mart%,name.ilike.%hafiz-super-store%`);
    
  if (!tenants || tenants.length === 0) {
    console.log("No matching tenants found.");
    return;
  }
  
  const tenantIds = tenants.map(t => t.id);
  console.log(`Found ${tenants.length} potential tenants.`);

  // 2. Query sales
  const { data: sales } = await supabaseAdmin
    .from('sales')
    .select(`
      id, invoice_no, total, created_at, note, tenant_id,
      sale_items (id, name, product_id)
    `)
    .in('tenant_id', tenantIds)
    .gte('created_at', targetDateStart)
    .lte('created_at', targetDateEnd);

  console.log(`\n--- Sales on 2026-08-01 (${sales?.length || 0} found) ---`);
  
  sales?.forEach(s => {
    const items = (s.sale_items as any[]) || [];
    const isAnomalous = items.length === 0 || items.some(i => !i.product_id);
    
    if (isAnomalous) {
      const tenantName = tenants.find(t => t.id === s.tenant_id)?.name;
      console.log(`[FAKE?] Invoice: ${s.invoice_no} | Total: ${s.total} | Store: ${tenantName}`);
      console.log(`      Items: ${items.length} | Note: ${s.note || 'None'}`);
      items.filter(i => !i.product_id).forEach(i => console.log(`      - Item without Product ID: "${i.name}"`));
      console.log('-------------------------------------------------');
    }
  });

  // 3. Query manual ledger entries (party_payments)
  const { data: payments } = await supabaseAdmin
    .from('party_payments')
    .select(`
      id, amount, note, created_at, party_id, tenant_id,
      customers (name)
    `)
    .in('tenant_id', tenantIds)
    .gte('created_at', targetDateStart)
    .lte('created_at', targetDateEnd)
    .eq('party_type', 'customer');

  console.log(`\n--- Manual Ledger Payments on 2026-08-01 (${payments?.length || 0} found) ---`);
  payments?.forEach(p => {
    const customerName = (p.customers as any)?.name || 'Unknown';
    const tenantName = tenants.find(t => t.id === p.tenant_id)?.name;
    console.log(`Payment: ${p.amount} | Customer: ${customerName} | Store: ${tenantName}`);
    console.log(`   Note: ${p.note || 'None'}`);
    console.log('-------------------------------------------------');
  });
}

auditShop().catch(console.error);
