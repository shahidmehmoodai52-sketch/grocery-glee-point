
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function auditShop() {
  const shopPart = 'Hafiz';
  const targetDateStart = '2026-08-01T00:00:00Z';
  const targetDateEnd = '2026-08-01T23:59:59Z';

  console.log(`Auditing Hafiz for ALL entries on 2026-08-01 (Sales & Ledger)...`);
  
  const { data: tenants } = await supabaseAdmin.from('tenants').select('id, name').ilike('name', `%${shopPart}%`);
  const tenantIds = tenants?.map(t => t.id) || [];
  
  const { data: sales } = await supabaseAdmin
    .from('sales')
    .select(`id, invoice_no, total, created_at, note, tenant_id, sale_items(id, name, product_id)`)
    .in('tenant_id', tenantIds)
    .gte('created_at', targetDateStart)
    .lte('created_at', targetDateEnd);

  console.log(`\n--- ALL SALES (Aug 1st) ---`);
  sales?.forEach(s => {
    const items = (s.sale_items as any[]) || [];
    const missingProducts = items.filter(i => !i.product_id).length;
    console.log(`Invoice: ${s.invoice_no} | Total: ${s.total} | Items: ${items.length} | Missing Prods: ${missingProducts} | Note: ${s.note || ''}`);
  });

  const { data: payments } = await supabaseAdmin
    .from('party_payments')
    .select(`id, amount, note, created_at, party_id, tenant_id, customers(name)`)
    .in('tenant_id', tenantIds)
    .gte('created_at', targetDateStart)
    .lte('created_at', targetDateEnd);

  console.log(`\n--- ALL LEDGER PAYMENTS (Aug 1st) ---`);
  payments?.forEach(p => {
    console.log(`Payment: ${p.amount} | Customer: ${(p.customers as any)?.name} | Note: ${p.note || ''}`);
  });
}

auditShop().catch(console.error);
