import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  const { data: tenants } = await supabase.from('tenants').select('id, name');
  const tenantIds = tenants?.filter(t => t.name.toLowerCase().includes('hafiz')).map(t => t.id) || [];

  console.log('Fetching ALL Ledger Entries for Hafiz Tenants...');
  const { data: allPayments } = await supabase
    .from('party_payments')
    .select('id, amount, created_at, note, tenant_id')
    .in('tenant_id', tenantIds)
    .order('created_at', { ascending: false });

  console.log(`Auditing ${allPayments?.length || 0} ledger entries...`);
  
  const matches = allPayments?.filter(p => {
    const isAug1 = p.created_at.includes('2026-08-01');
    const isTarget = p.note?.includes('1209') || p.note?.includes('1213') || isAug1;
    return isTarget;
  });

  if (matches && matches.length > 0) {
    console.log('\nMatches found:');
    matches.forEach(m => {
      console.log(`Date: ${m.created_at}, Amt: ${m.amount}, Note: ${m.note}`);
    });
  } else {
    console.log('\nNo entries for Aug 1st or matching S-1209/S-1213 found in ledger.');
  }

  // Check sales table count
  const { count } = await supabase.from('sales').select('*', { count: 'exact', head: true });
  console.log(`\nTotal rows in sales table: ${count}`);
}

audit();
