import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  const { data: tenants } = await supabase.from('tenants').select('id, name');
  const tenantIds = tenants?.filter(t => t.name.toLowerCase().includes('hafiz')).map(t => t.id) || [];

  console.log('Searching for Ledger entries (party_payments) mentioning 1209 or 1213 globally...');
  const { data: globalPayments } = await supabase
    .from('party_payments')
    .select('id, amount, created_at, note, tenant_id')
    .or('note.ilike.%1209%,note.ilike.%1213%,note.ilike.%S-1209%,note.ilike.%S-1213%');

  console.log(`Found ${globalPayments?.length || 0} matching ledger entries.`);
  globalPayments?.forEach(p => {
    const tenant = tenants?.find(t => t.id === p.tenant_id);
    console.log(`Date: ${p.created_at}, Amt: ${p.amount}, Note: ${p.note}, Shop: ${tenant?.name}`);
  });

  console.log('\nChecking all sales globally (limit 500) created on 2026-08-01...');
  const { data: allAug1Sales } = await supabase
    .from('sales')
    .select('id, invoice_number, total_amount, created_at, tenant_id')
    .gte('created_at', '2026-08-01T00:00:00Z')
    .lt('created_at', '2026-08-02T00:00:00Z')
    .limit(500);

  console.log(`Global Sales on Aug 1st: ${allAug1Sales?.length || 0}`);
  allAug1Sales?.forEach(s => {
    const tenant = tenants?.find(t => t.id === s.tenant_id);
    if (tenant?.name.toLowerCase().includes('hafiz') || s.invoice_number.includes('1209') || s.invoice_number.includes('1213')) {
        console.log(`[MATCH] Invoice: ${s.invoice_number}, Amt: ${s.total_amount}, Date: ${s.created_at}, Shop: ${tenant?.name}`);
    }
  });

  console.log('\nChecking ALL ledger entries globally on Aug 1st...');
  const { data: allAug1Payments } = await supabase
    .from('party_payments')
    .select('id, amount, created_at, note, tenant_id')
    .gte('created_at', '2026-08-01T00:00:00Z')
    .lt('created_at', '2026-08-02T00:00:00Z');

  console.log(`Global Ledger Entries on Aug 1st: ${allAug1Payments?.length || 0}`);
  allAug1Payments?.forEach(p => {
    const tenant = tenants?.find(t => t.id === p.tenant_id);
    console.log(`Date: ${p.created_at}, Amt: ${p.amount}, Note: ${p.note}, Shop: ${tenant?.name}`);
  });
}

audit();
