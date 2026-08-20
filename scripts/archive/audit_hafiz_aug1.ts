import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  const shopCode = 'hafiz-super-mart-023';
  const targetDateStr = '2026-08-01';

  console.log(`Starting audit for ${shopCode} on ${targetDateStr}...`);

  // 1. Find all tenant IDs related to this shop code
  const { data: tenants, error: tError } = await supabase
    .from('tenants')
    .select('id, name, shop_code')
    .or(`shop_code.eq.${shopCode},name.ilike.%Hafiz%`);

  if (tError) {
    console.error('Error fetching tenants:', tError);
    return;
  }

  const tenantIds = tenants?.map(t => t.id) || [];
  console.log('Target Tenant IDs:', tenantIds);

  // 2. Fetch all sales for these tenants on Aug 1st, 2026
  // Note: We'll check the 'created_at' or 'date' column depending on schema
  const { data: sales, error: sError } = await supabase
    .from('sales')
    .select('id, invoice_number, total_amount, created_at, customer_id, tenant_id')
    .in('tenant_id', tenantIds)
    .gte('created_at', `${targetDateStr}T00:00:00Z`)
    .lt('created_at', `2026-08-02T00:00:00Z`);

  if (sError) {
    console.error('Error fetching sales:', sError);
  }

  console.log(`\n--- Sales Found for Aug 1st (Total: ${sales?.length || 0}) ---`);
  if (sales) {
    for (const sale of sales) {
        // Fetch items to see if it has valid products
        const { data: items } = await supabase
            .from('sale_items')
            .select('id, product_id, quantity, unit_price')
            .eq('sale_id', sale.id);
        
        console.log(`Invoice: ${sale.invoice_number}, Total: ${sale.total_amount}, Items Count: ${items?.length || 0}, CreatedAt: ${sale.created_at}`);
    }
  }

  // 3. Search specifically for S-1209 and S-1213
  const { data: specificSales, error: specError } = await supabase
    .from('sales')
    .select('id, invoice_number, total_amount, created_at, tenant_id')
    .in('invoice_number', ['S-1209', 'S-1213', '1209', '1213']);

  console.log(`\n--- Specific Invoices Lookup (S-1209/S-1213) ---`);
  if (specificSales && specificSales.length > 0) {
    specificSales.forEach(s => {
        console.log(`Found: ${s.invoice_number}, Total: ${s.total_amount}, Date: ${s.created_at}, Tenant: ${s.tenant_id}`);
    });
  } else {
    console.log('Invoices S-1209 and S-1213 not found in standard sales table.');
  }

  // 4. Check party_payments (Customer Ledger entries) for Aug 1st
  const { data: payments, error: pError } = await supabase
    .from('party_payments')
    .select('id, amount, payment_type, created_at, note, tenant_id')
    .in('tenant_id', tenantIds)
    .gte('created_at', `${targetDateStr}T00:00:00Z`)
    .lt('created_at', `2026-08-02T00:00:00Z`);

  console.log(`\n--- Ledger Entries (party_payments) for Aug 1st (Total: ${payments?.length || 0}) ---`);
  if (payments) {
    payments.forEach(p => {
        console.log(`Payment ID: ${p.id}, Amount: ${p.amount}, Type: ${p.payment_type}, Note: ${p.note}, Date: ${p.created_at}`);
    });
  }
}

audit();
