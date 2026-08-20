import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  const targetDateStr = '2026-08-01';

  // 1. Fetch tenants by name since shop_code was missing in previous attempt
  const { data: tenants, error: tError } = await supabase
    .from('tenants')
    .select('id, name')
    .ilike('name', '%Hafiz%');

  if (tError) {
    console.error('Error fetching tenants:', tError);
    return;
  }

  const tenantIds = tenants?.map(t => t.id) || [];
  console.log('Target Tenant IDs:', tenantIds);

  // 2. Search specifically for S-1209 and S-1213 globally
  const { data: specificSales } = await supabase
    .from('sales')
    .select('id, invoice_number, total_amount, created_at, tenant_id')
    .or('invoice_number.eq.S-1209,invoice_number.eq.1209,invoice_number.eq.S-1213,invoice_number.eq.1213');

  console.log(`\n--- Global Lookup for S-1209/S-1213 ---`);
  if (specificSales && specificSales.length > 0) {
    specificSales.forEach(s => {
        console.log(`Found: ${s.invoice_number}, Total: ${s.total_amount}, Date: ${s.created_at}, Tenant: ${s.tenant_id}`);
    });
  } else {
    console.log('Invoices S-1209 and S-1213 not found in standard sales table.');
  }

  // 3. Search for ANY sales on Aug 1st for Hafiz tenants
  const { data: sales, error: sError } = await supabase
    .from('sales')
    .select('id, invoice_number, total_amount, created_at, tenant_id')
    .in('tenant_id', tenantIds)
    .gte('created_at', `${targetDateStr}T00:00:00Z`)
    .lt('created_at', `2026-08-02T00:00:00Z`);

  console.log(`\n--- Sales Found for Aug 1st (Total: ${sales?.length || 0}) ---`);
  if (sales) {
    sales.forEach(sale => {
      console.log(`Invoice: ${sale.invoice_number}, Total: ${sale.total_amount}, Date: ${sale.created_at}`);
    });
  }

  // 4. Check party_payments (Customer Ledger entries) globally for Aug 1st
  const { data: allPayments } = await supabase
    .from('party_payments')
    .select('id, amount, payment_type, created_at, note, tenant_id')
    .gte('created_at', `${targetDateStr}T00:00:00Z`)
    .lt('created_at', `2026-08-02T00:00:00Z`);

  console.log(`\n--- Global Ledger Entries for Aug 1st (Total: ${allPayments?.length || 0}) ---`);
  if (allPayments) {
    allPayments.forEach(p => {
        const isHafiz = tenantIds.includes(p.tenant_id);
        console.log(`[${isHafiz ? 'HAFIZ' : 'OTHER'}] Payment ID: ${p.id}, Amount: ${p.amount}, Type: ${p.payment_type}, Note: ${p.note}, Date: ${p.created_at}`);
    });
  }
}

audit();
