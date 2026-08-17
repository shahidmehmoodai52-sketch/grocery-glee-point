
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function auditShop() {
  const shopCodePart = 'hafiz-super-mart';
  console.log(`Auditing all sales for tenants containing "${shopCodePart}"...`);
  
  const { data: tenants } = await supabaseAdmin.from('tenants').select('id, name').ilike('name', `%${shopCodePart}%`);
  
  if (!tenants || tenants.length === 0) {
    console.log("No tenants found matching search.");
    return;
  }
  
  const tenantIds = tenants.map(t => t.id);
  console.log("Searching in tenants:", tenants.map(t => t.name));

  const { data: sales } = await supabaseAdmin
    .from('sales')
    .select(`
      id, invoice_no, total, created_at, note, tenant_id,
      sale_items (id, name, product_id)
    `)
    .in('tenant_id', tenantIds)
    .order('created_at', { ascending: false });

  console.log(`\n--- Anomalous Sales Found (${sales?.length || 0} checked) ---`);
  
  sales?.forEach(s => {
    const items = (s.sale_items as any[]) || [];
    const isAnomalous = items.length === 0 || items.some(i => !i.product_id);
    
    if (isAnomalous) {
      const tenantName = tenants.find(t => t.id === s.tenant_id)?.name;
      console.log(`[!] Store: ${tenantName} | Date: ${s.created_at} | Invoice: ${s.invoice_no} | Total: ${s.total}`);
      console.log(`    Note: ${s.note || 'None'}`);
      console.log(`    Items Count: ${items.length}`);
      items.filter(i => !i.product_id).forEach(i => console.log(`    - Missing Product ID: "${i.name}"`));
      console.log('-------------------------------------------------');
    }
  });

  const { data: payments } = await supabaseAdmin
    .from('party_payments')
    .select(`
      id, amount, note, created_at, party_id, tenant_id,
      customers (name)
    `)
    .in('tenant_id', tenantIds)
    .order('created_at', { ascending: false });

  console.log(`\n--- All Ledger Payments for these tenants (${payments?.length || 0} total) ---`);
  payments?.forEach(p => {
    const customerName = (p.customers as any)?.name || 'Unknown';
    const tenantName = tenants.find(t => t.id === p.tenant_id)?.name;
    console.log(`[!] Store: ${tenantName} | Date: ${p.created_at} | Payment: ${p.amount} | Customer: ${customerName}`);
    console.log(`    Note: ${p.note || 'None'}`);
    console.log('-------------------------------------------------');
  });
}

auditShop().catch(console.error);
