import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  const { data: tenants } = await supabase.from('tenants').select('id, name');
  const tenantIds = tenants?.filter(t => t.name.toLowerCase().includes('hafiz')).map(t => t.id) || [];

  console.log('Fetching ALL sales for Hafiz tenants (iterative)...');
  
  let allSales: any[] = [];
  let from = 0;
  let to = 999;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('sales')
      .select('invoice_number, total_amount, created_at, tenant_id')
      .in('tenant_id', tenantIds)
      .range(from, to);

    if (error || !data || data.length === 0) {
      hasMore = false;
    } else {
      allSales = [...allSales, ...data];
      from += 1000;
      to += 1000;
      if (data.length < 1000) hasMore = false;
    }
  }

  console.log(`Audited ${allSales.length} total sales for Hafiz.`);
  
  const matches = allSales.filter(s => {
    const isAug1 = s.created_at.includes('2026-08-01');
    const isTarget = s.invoice_number?.includes('1209') || s.invoice_number?.includes('1213') || isAug1;
    return isTarget;
  });

  if (matches.length > 0) {
    console.log('\nMatches found in Sales:');
    matches.forEach(m => {
      console.log(`Invoice: ${m.invoice_number}, Amt: ${m.total_amount}, Date: ${m.created_at}`);
    });
  } else {
    console.log('\nNo matching invoices found in Hafiz sales history.');
  }
}

audit();
