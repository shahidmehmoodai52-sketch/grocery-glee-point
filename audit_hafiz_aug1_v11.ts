import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  const { data: tenants } = await supabase.from('tenants').select('id, name');

  console.log('Searching for S-1209 and S-1213 across ALL tenants...');
  
  const { data: sales } = await supabase
    .from('sales')
    .select('invoice_number, total_amount, created_at, tenant_id')
    .or('invoice_number.ilike.%1209%,invoice_number.ilike.%1213%');

  if (sales && sales.length > 0) {
    sales.forEach(s => {
      const t = tenants?.find(x => x.id === s.tenant_id);
      console.log(`Invoice: ${s.invoice_number}, Amt: ${s.total_amount}, Date: ${s.created_at}, Tenant: ${t?.name}`);
    });
  } else {
    console.log('No invoices matching 1209 or 1213 found globally.');
  }

  console.log('\nSearching for Aug 1st records for Hafiz Super Mart (53c6869f-50d3-48a1-b7a9-0856fd444d67)...');
  const targetTenant = '53c6869f-50d3-48a1-b7a9-0856fd444d67';
  
  const { data: aug1Sales } = await supabase
    .from('sales')
    .select('*')
    .eq('tenant_id', targetTenant)
    .gte('created_at', '2026-08-01T00:00:00Z')
    .lt('created_at', '2026-08-02T00:00:00Z');
  
  console.log(`Sales on Aug 1: ${aug1Sales?.length || 0}`);

  const { data: allAug1Payments } = await supabase
    .from('party_payments')
    .select('*')
    .eq('tenant_id', targetTenant)
    .gte('created_at', '2026-08-01T00:00:00Z')
    .lt('created_at', '2026-08-02T00:00:00Z');

  console.log(`Ledger on Aug 1: ${allAug1Payments?.length || 0}`);
}

audit();
