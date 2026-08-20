import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  const { data: tenants } = await supabase.from('tenants').select('id, name');
  const tenantIds = tenants?.filter(t => t.name.toLowerCase().includes('hafiz')).map(t => t.id) || [];

  console.log('Fetching OLD sales for Hafiz (2026-06-01 to 2026-08-01)...');
  const { data: oldSales } = await supabase
    .from('sales')
    .select('id, invoice_number, total_amount, created_at, tenant_id')
    .in('tenant_id', tenantIds)
    .gte('created_at', '2026-06-01T00:00:00Z')
    .lt('created_at', '2026-08-10T00:00:00Z')
    .order('created_at', { ascending: false })
    .limit(100);

  console.log(`Found ${oldSales?.length || 0} old sales.`);
  oldSales?.forEach(s => {
    console.log(`Invoice: ${s.invoice_number}, Date: ${s.created_at}, Amt: ${s.total_amount}`);
  });

  console.log('\nChecking Party Payments for the same period...');
  const { data: oldPayments } = await supabase
    .from('party_payments')
    .select('id, amount, created_at, note, tenant_id')
    .in('tenant_id', tenantIds)
    .gte('created_at', '2026-06-01T00:00:00Z')
    .lt('created_at', '2026-08-10T00:00:00Z')
    .order('created_at', { ascending: false })
    .limit(100);

  console.log(`Found ${oldPayments?.length || 0} ledger entries.`);
  oldPayments?.forEach(p => {
    console.log(`Date: ${p.created_at}, Amt: ${p.amount}, Note: ${p.note}`);
  });
}

audit();
