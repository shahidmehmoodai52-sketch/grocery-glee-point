import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  const { data: tenants } = await supabase.from('tenants').select('id, name');
  const tenantIds = tenants?.filter(t => t.name.toLowerCase().includes('hafiz')).map(t => t.id) || [];

  console.log('Fetching ALL Sales for Hafiz Tenants (no date filter)...');
  const { data: allSales } = await supabase
    .from('sales')
    .select('id, invoice_number, total_amount, created_at, tenant_id')
    .in('tenant_id', tenantIds)
    .order('created_at', { ascending: false })
    .limit(100);

  console.log(`Found ${allSales?.length || 0} recent sales.`);
  allSales?.forEach(s => {
    console.log(`Invoice: ${s.invoice_number}, Amt: ${s.total_amount}, Date: ${s.created_at}`);
  });

  console.log('\nFetching ALL Ledger Entries for Hafiz Tenants (no date filter)...');
  const { data: allPayments } = await supabase
    .from('party_payments')
    .select('id, amount, created_at, note, tenant_id')
    .in('tenant_id', tenantIds)
    .order('created_at', { ascending: false })
    .limit(200);

  console.log(`Found ${allPayments?.length || 0} ledger entries.`);
  allPayments?.forEach(p => {
    // Check if the note contains "1209" or "1213" or if date is Aug 1st
    const isAug1 = p.created_at.includes('2026-08-01');
    const isTarget = p.note?.includes('1209') || p.note?.includes('1213') || isAug1;
    if (isTarget) {
        console.log(`[MATCH] Date: ${p.created_at}, Amt: ${p.amount}, Note: ${p.note}`);
    }
  });

  // Specifically check for S-1209 or S-1213 in sales globally again, but check if invoice_number is different format
  const { data: searchSales } = await supabase
    .from('sales')
    .select('id, invoice_number, total_amount, created_at, tenant_id')
    .or('invoice_number.ilike.%1209%,invoice_number.ilike.%1213%');
  
  if (searchSales && searchSales.length > 0) {
    console.log('\nFound sales matching 1209/1213:');
    searchSales.forEach(s => console.log(s));
  }
}

audit();
