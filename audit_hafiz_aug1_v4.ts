import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  const { data: tenants } = await supabase.from('tenants').select('id, name');
  const tenantIds = tenants?.filter(t => t.name.toLowerCase().includes('hafiz')).map(t => t.id) || [];

  console.log('Searching in Sales...');
  const { data: s1209 } = await supabase.from('sales').select('*').ilike('invoice_number', '%1209%');
  const { data: s1213 } = await supabase.from('sales').select('*').ilike('invoice_number', '%1213%');
  
  console.log('S-1209 records:', s1209);
  console.log('S-1213 records:', s1213);

  console.log('\nSearching in Party Payments...');
  const { data: p1209 } = await supabase.from('party_payments').select('*').ilike('note', '%1209%');
  const { data: p1213 } = await supabase.from('party_payments').select('*').ilike('note', '%1213%');
  
  console.log('1209 in Ledger:', p1209);
  console.log('1213 in Ledger:', p1213);

  console.log('\nChecking all Ledger entries for Hafiz tenants (recent)...');
  const { data: recentLedger } = await supabase
    .from('party_payments')
    .select('*')
    .in('tenant_id', tenantIds)
    .order('created_at', { ascending: false })
    .limit(50);
  
  recentLedger?.forEach(r => {
    console.log(`Date: ${r.created_at}, Amt: ${r.amount}, Note: ${r.note}`);
  });
}

audit();
