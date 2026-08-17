
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function auditShop() {
  const shopPart = 'Hafiz';
  console.log(`Auditing all sales and payments for shops containing "${shopPart}"...`);
  
  const { data: tenants } = await supabaseAdmin.from('tenants').select('id, name').ilike('name', `%${shopPart}%`);
  const tenantIds = tenants?.map(t => t.id) || [];
  
  const { data: sales } = await supabaseAdmin
    .from('sales')
    .select(`
      id, invoice_no, total, created_at, note, tenant_id,
      sale_items (id, name, product_id)
    `)
    .in('tenant_id', tenantIds)
    .gte('created_at', '2026-08-01T00:00:00Z')
    .order('created_at', { ascending: false });

  console.log(`\n--- ALL Sales for Hafiz since Aug 1st (${sales?.length || 0} total) ---`);
  
  sales?.forEach(s => {
    console.log(`Date: ${s.created_at} | Invoice: ${s.invoice_no} | Total: ${s.total} | Items: ${(s.sale_items as any[])?.length || 0}`);
  });

  const { data: payments } = await supabaseAdmin
    .from('party_payments')
    .select(`
      id, amount, note, created_at, party_id, tenant_id,
      customers (name)
    `)
    .in('tenant_id', tenantIds)
    .gte('created_at', '2026-08-01T00:00:00Z')
    .order('created_at', { ascending: false });

  console.log(`\n--- ALL Manual Payments for Hafiz since Aug 1st (${payments?.length || 0} total) ---`);
  payments?.forEach(p => {
    const customerName = (p.customers as any)?.name || 'Unknown';
    console.log(`Date: ${p.created_at} | Payment: ${p.amount} | Customer: ${customerName} | Note: ${p.note || 'None'}`);
  });
}

auditShop().catch(console.error);
