
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function auditShop() {
  const targetDateStart = '2026-08-01T00:00:00Z';
  const targetDateEnd = '2026-08-01T23:59:59Z';

  console.log(`Auditing ALL sales for date 2026-08-01 to find fake invoices...`);
  
  // 1. Get all tenants first for name lookup
  const { data: tenants } = await supabaseAdmin.from('tenants').select('id, name');
  
  // 2. Query sales across all tenants for that date
  const { data: sales } = await supabaseAdmin
    .from('sales')
    .select(`
      id, invoice_no, total, created_at, note, tenant_id,
      sale_items (id, name, product_id)
    `)
    .gte('created_at', targetDateStart)
    .lte('created_at', targetDateEnd);

  console.log(`\n--- Potential Fake Invoices on 2026-08-01 (${sales?.length || 0} total sales) ---`);
  
  sales?.forEach(s => {
    const items = (s.sale_items as any[]) || [];
    const isAnomalous = items.length === 0 || items.some(i => !i.product_id);
    
    if (isAnomalous) {
      const tenantName = tenants?.find(t => t.id === s.tenant_id)?.name || 'Unknown';
      console.log(`[!] Store: ${tenantName} | Invoice: ${s.invoice_no} | Total: ${s.total}`);
      console.log(`    Note: ${s.note || 'None'}`);
      console.log(`    Items: ${items.length}`);
      items.filter(i => !i.product_id).forEach(i => console.log(`    - Missing Product ID: "${i.name}"`));
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
    .gte('created_at', targetDateStart)
    .lte('created_at', targetDateEnd)
    .eq('party_type', 'customer');

  console.log(`\n--- Manual Ledger Payments on 2026-08-01 (${payments?.length || 0} total) ---`);
  payments?.forEach(p => {
    const customerName = (p.customers as any)?.name || 'Unknown';
    const tenantName = tenants?.find(t => t.id === p.tenant_id)?.name || 'Unknown';
    console.log(`[!] Store: ${tenantName} | Payment: ${p.amount} | Customer: ${customerName}`);
    console.log(`    Note: ${p.note || 'None'}`);
    console.log('-------------------------------------------------');
  });
}

auditShop().catch(console.error);
