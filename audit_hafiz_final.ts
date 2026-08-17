
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function auditShop() {
  const shopPart = 'Hafiz';
  console.log(`Auditing ALL sales and payments for shops containing "${shopPart}"...`);
  
  const { data: tenants } = await supabaseAdmin.from('tenants').select('id, name').ilike('name', `%${shopPart}%`);
  const tenantIds = tenants?.map(t => t.id) || [];
  console.log(`Searching in: ${tenants?.map(t => t.name).join(', ')}`);
  
  const { data: sales } = await supabaseAdmin
    .from('sales')
    .select(`
      id, invoice_no, total, created_at, note, tenant_id,
      sale_items (id, name, product_id)
    `)
    .in('tenant_id', tenantIds)
    .order('created_at', { ascending: false });

  console.log(`\n--- ALL Sales for ${shopPart} (${sales?.length || 0} total) ---`);
  
  sales?.forEach(s => {
    const items = (s.sale_items as any[]) || [];
    const isAnomalous = items.length === 0 || items.some(i => !i.product_id);
    
    if (isAnomalous) {
      console.log(`[ANOMALY] Date: ${s.created_at} | Invoice: ${s.invoice_no} | Total: ${s.total}`);
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
    .in('tenant_id', tenantIds)
    .order('created_at', { ascending: false });

  console.log(`\n--- ALL Manual Payments for ${shopPart} (${payments?.length || 0} total) ---`);
  payments?.forEach(p => {
    const customerName = (p.customers as any)?.name || 'Unknown';
    console.log(`[PAYMENT] Date: ${p.created_at} | Payment: ${p.amount} | Customer: ${customerName}`);
    console.log(`    Note: ${p.note || 'None'}`);
    console.log('-------------------------------------------------');
  });
}

auditShop().catch(console.error);
