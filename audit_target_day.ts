
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function auditShop() {
  const shopPart = 'Hafiz';
  const targetDateStart = '2026-08-01T00:00:00Z';
  const targetDateEnd = '2026-08-01T23:59:59Z';

  console.log(`Deep auditing "${shopPart}" for fake entries on 2026-08-01...`);
  
  const { data: tenants } = await supabaseAdmin.from('tenants').select('id, name').ilike('name', `%${shopPart}%`);
  const tenantIds = tenants?.map(t => t.id) || [];
  
  // Fetch ALL sales for these tenants on that specific day
  const { data: sales } = await supabaseAdmin
    .from('sales')
    .select(`
      id, invoice_no, total, created_at, note, tenant_id, customer_id,
      sale_items (id, name, product_id)
    `)
    .in('tenant_id', tenantIds)
    .gte('created_at', targetDateStart)
    .lte('created_at', targetDateEnd);

  console.log(`\n--- Sales on 2026-08-01 (${sales?.length || 0} found) ---`);
  
  sales?.forEach(s => {
    const items = (s.sale_items as any[]) || [];
    // A "fake" invoice typically has no linked products or was manually injected into the ledger
    const hasNoProducts = items.length === 0 || items.every(i => !i.product_id);
    const isManualTotal = s.note?.toLowerCase().includes('manual') || s.note?.includes(':');

    if (hasNoProducts || isManualTotal) {
      const storeName = tenants?.find(t => t.id === s.tenant_id)?.name;
      console.log(`[POTENTIAL FAKE] Invoice: ${s.invoice_no} | Total: ${s.total} | Store: ${storeName}`);
      console.log(`    Time: ${s.created_at} | Note: ${s.note || 'None'}`);
      console.log(`    Items: ${items.length} (Product IDs missing: ${items.filter(i => !i.product_id).length})`);
      items.filter(i => !i.product_id).forEach(i => console.log(`    - Item: "${i.name}"`));
      console.log('-------------------------------------------------');
    }
  });

  // Fetch ALL ledger payments for that day
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

  console.log(`\n--- Ledger Entries on 2026-08-01 (${payments?.length || 0} found) ---`);
  payments?.forEach(p => {
    const customerName = (p.customers as any)?.name || 'Unknown';
    const storeName = tenants?.find(t => t.id === p.tenant_id)?.name;
    // Entries that don't come from a sale but hit the ledger
    console.log(`[LEDGER ENTRY] Customer: ${customerName} | Amount: ${p.amount} | Store: ${storeName}`);
    console.log(`    Time: ${p.created_at} | Note: ${p.note || 'None'}`);
    console.log('-------------------------------------------------');
  });
}

auditShop().catch(console.error);
