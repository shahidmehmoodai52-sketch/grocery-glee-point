import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  const { data: tenants } = await supabase.from('tenants').select('id, name');
  const tenantIds = tenants?.filter(t => t.name.toLowerCase().includes('hafiz')).map(t => t.id) || [];

  console.log('Searching for sales on 2026-08-01 (Aug 1st) for Hafiz tenants...');
  
  // Checking ALL sales for these tenants from the start of Aug until now to see if the date was mapped differently
  const { data: augSales } = await supabase
    .from('sales')
    .select('id, invoice_number, total_amount, created_at, tenant_id')
    .in('tenant_id', tenantIds)
    .gte('created_at', '2026-08-01T00:00:00Z')
    .lt('created_at', '2026-08-02T00:00:00Z')
    .order('created_at', { ascending: true });

  console.log(`Sales on Aug 1st (count: ${augSales?.length || 0}):`);
  augSales?.forEach(s => {
    console.log(`Invoice: ${s.invoice_number}, Amt: ${s.total_amount}, Date: ${s.created_at}`);
  });

  console.log('\nChecking Party Payments for Aug 1st...');
  const { data: augPayments } = await supabase
    .from('party_payments')
    .select('id, amount, created_at, note, tenant_id')
    .in('tenant_id', tenantIds)
    .gte('created_at', '2026-08-01T00:00:00Z')
    .lt('created_at', '2026-08-02T00:00:00Z');

  console.log(`Ledger Entries on Aug 1st (count: ${augPayments?.length || 0}):`);
  augPayments?.forEach(p => {
    console.log(`Date: ${p.created_at}, Amt: ${p.amount}, Note: ${p.note}`);
  });

  // Searching for 1209 and 1213 specifically by invoice number substring
  console.log('\nGlobal search for invoice_number matching 1209 or 1213...');
  const { data: matchingSales } = await supabase
    .from('sales')
    .select('id, invoice_number, total_amount, created_at, tenant_id')
    .or('invoice_number.ilike.%1209%,invoice_number.ilike.%1213%');

  matchingSales?.forEach(s => {
    const tenant = tenants?.find(t => t.id === s.tenant_id);
    console.log(`Found: ${s.invoice_number}, Amt: ${s.total_amount}, Date: ${s.created_at}, Shop: ${tenant?.name}`);
  });
}

audit();
