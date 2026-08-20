import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  const targetDateStr = '2026-08-01';

  // 1. Fetch ALL tenants to identify the correct IDs
  const { data: tenants } = await supabase.from('tenants').select('id, name');
  const hafizTenants = tenants?.filter(t => t.name.toLowerCase().includes('hafiz')) || [];
  const tenantIds = hafizTenants.map(t => t.id);
  console.log('Hafiz Tenants identified:', hafizTenants);

  // 2. Search for S-1209 and S-1213 globally in sales table (with different date formats)
  const { data: specificSales } = await supabase
    .from('sales')
    .select('id, invoice_number, total_amount, created_at, tenant_id')
    .or('invoice_number.ilike.%1209%,invoice_number.ilike.%1213%');

  console.log(`\n--- Global Lookup for invoices containing 1209 or 1213 ---`);
  if (specificSales && specificSales.length > 0) {
    specificSales.forEach(s => {
        console.log(`Found: ${s.invoice_number}, Total: ${s.total_amount}, Date: ${s.created_at}, Tenant: ${s.tenant_id}`);
    });
  }

  // 3. Look at ALL sales on Aug 1st globally
  const { data: allSales } = await supabase
    .from('sales')
    .select('id, invoice_number, total_amount, created_at, tenant_id')
    .gte('created_at', `2026-08-01T00:00:00Z`)
    .lt('created_at', `2026-08-02T00:00:00Z`);

  console.log(`\n--- Global Sales on Aug 1st (Total: ${allSales?.length || 0}) ---`);
  if (allSales) {
    allSales.forEach(s => {
        const tenant = tenants?.find(t => t.id === s.tenant_id);
        console.log(`Invoice: ${s.invoice_number}, Amount: ${s.total_amount}, Date: ${s.created_at}, Tenant: ${tenant?.name || s.tenant_id}`);
    });
  }

  // 4. Look at all sales recorded as happening on Aug 1st, regardless of 'created_at' timestamp
  // (In case there is a 'date' column)
  const { data: salesByDate } = await supabase
    .from('sales')
    .select('id, invoice_number, total_amount, created_at, tenant_id')
    .eq('created_at' as any, '2026-08-01'); // Trying direct match

  // 5. Check party_payments globally for Aug 1st
  const { data: allPayments } = await supabase
    .from('party_payments')
    .select('id, amount, created_at, tenant_id, note')
    .gte('created_at', `2026-08-01T00:00:00Z`)
    .lt('created_at', `2026-08-02T00:00:00Z`);

  console.log(`\n--- Global Ledger Entries (party_payments) on Aug 1st (Total: ${allPayments?.length || 0}) ---`);
  if (allPayments) {
    allPayments.forEach(p => {
        const tenant = tenants?.find(t => t.id === p.tenant_id);
        console.log(`Payment ID: ${p.id}, Amount: ${p.amount}, Date: ${p.created_at}, Tenant: ${tenant?.name || p.tenant_id}, Note: ${p.note}`);
    });
  }
}

audit();
