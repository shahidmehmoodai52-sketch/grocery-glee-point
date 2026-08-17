
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function auditShop() {
  console.log(`Auditing ALL sales ever for potential fake invoices...`);
  
  const { data: tenants } = await supabaseAdmin.from('tenants').select('id, name');
  
  const { data: sales } = await supabaseAdmin
    .from('sales')
    .select(`
      id, invoice_no, total, created_at, note, tenant_id,
      sale_items (id, name, product_id)
    `)
    .order('created_at', { ascending: false })
    .limit(100);

  console.log(`\n--- Most Recent 100 Sales ---`);
  
  sales?.forEach(s => {
    const items = (s.sale_items as any[]) || [];
    const isAnomalous = items.length === 0 || items.some(i => !i.product_id);
    
    if (isAnomalous) {
      const tenantName = tenants?.find(t => t.id === s.tenant_id)?.name || 'Unknown';
      console.log(`[!] Store: ${tenantName} | Date: ${s.created_at} | Invoice: ${s.invoice_no} | Total: ${s.total}`);
      console.log(`    Note: ${s.note || 'None'}`);
      console.log(`    Items: ${items.length}`);
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
    .order('created_at', { ascending: false })
    .limit(100);

  console.log(`\n--- Most Recent 100 Ledger Payments ---`);
  payments?.forEach(p => {
    const customerName = (p.customers as any)?.name || 'Unknown';
    const tenantName = tenants?.find(t => t.id === p.tenant_id)?.name || 'Unknown';
    console.log(`[!] Store: ${tenantName} | Date: ${p.created_at} | Payment: ${p.amount} | Customer: ${customerName}`);
    console.log(`    Note: ${p.note || 'None'}`);
    console.log('-------------------------------------------------');
  });
}

auditShop().catch(console.error);
