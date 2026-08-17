
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function auditShop() {
  const shopPart = 'Hafiz';
  // Check both Aug 1st and Aug 15th (where an anomaly was previously seen)
  const dates = [
    { start: '2026-08-01T00:00:00Z', end: '2026-08-01T23:59:59Z', label: 'Aug 1st' },
    { start: '2026-08-15T00:00:00Z', end: '2026-08-15T23:59:59Z', label: 'Aug 15th' }
  ];
  
  const { data: tenants } = await supabaseAdmin.from('tenants').select('id, name').ilike('name', `%${shopPart}%`);
  const tenantIds = tenants?.map(t => t.id) || [];
  
  for (const date of dates) {
    console.log(`\n=== Auditing ${date.label} for ${shopPart} ===`);
    
    const { data: sales } = await supabaseAdmin
      .from('sales')
      .select(`id, invoice_no, total, created_at, note, tenant_id, sale_items(id, name, product_id)`)
      .in('tenant_id', tenantIds)
      .gte('created_at', date.start)
      .lte('created_at', date.end);

    sales?.forEach(s => {
      const items = (s.sale_items as any[]) || [];
      const isFake = items.length === 0 || items.some(i => !i.product_id);
      if (isFake) {
        console.log(`[FAKE SALE] Invoice: ${s.invoice_no} | Total: ${s.total} | Date: ${s.created_at}`);
        console.log(`  Items: ${items.length} | Missing Product Links: ${items.filter(i => !i.product_id).length}`);
        console.log(`  Note: ${s.note || 'None'}`);
      }
    });

    const { data: payments } = await supabaseAdmin
      .from('party_payments')
      .select(`id, amount, note, created_at, customers(name)`)
      .in('tenant_id', tenantIds)
      .gte('created_at', date.start)
      .lte('created_at', date.end);

    payments?.forEach(p => {
      // Manual ledger entries often have notes like "Manual Adjustment" or "Cash Out"
      console.log(`[LEDGER ENTRY] Customer: ${(p.customers as any)?.name} | Amount: ${p.amount} | Note: ${p.note || 'None'}`);
    });
  }
}

auditShop().catch(console.error);
