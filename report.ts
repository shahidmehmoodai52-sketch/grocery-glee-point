
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function auditShop() {
  const shopPart = 'Hafiz';
  const targetDate = '2026-08-01';
  
  const { data: tenants } = await supabaseAdmin.from('tenants').select('id, name').ilike('name', `%${shopPart}%`);
  const tenantIds = tenants?.map(t => t.id) || [];
  
  const { data: sales } = await supabaseAdmin
    .from('sales')
    .select(`id, invoice_no, total, created_at, note, tenant_id, sale_items(id, name, product_id)`)
    .in('tenant_id', tenantIds)
    .gte('created_at', `${targetDate}T00:00:00Z`)
    .lte('created_at', `${targetDate}T23:59:59Z`);

  console.log(`REPORT FOR ${targetDate} (Shop: ${shopPart})`);
  sales?.forEach(s => {
    const items = (s.sale_items as any[]) || [];
    const isAnomalous = items.length === 0 || items.some(i => !i.product_id);
    if (isAnomalous) {
      console.log(`[FAKE] Invoice: ${s.invoice_no} | Total: ${s.total} | Date: ${s.created_at}`);
      console.log(`  Items: ${items.length} | Missing Product Links: ${items.filter(i => !i.product_id).length}`);
      console.log(`  Note: ${s.note || 'None'}`);
    }
  });

  const { data: payments } = await supabaseAdmin
    .from('party_payments')
    .select(`id, amount, note, created_at, customers(name)`)
    .in('tenant_id', tenantIds)
    .gte('created_at', `${targetDate}T00:00:00Z`)
    .lte('created_at', `${targetDate}T23:59:59Z`);

  payments?.forEach(p => {
    console.log(`[LEDGER] Customer: ${(p.customers as any)?.name} | Amount: ${p.amount} | Note: ${p.note || 'None'}`);
  });
}

auditShop().catch(console.error);
