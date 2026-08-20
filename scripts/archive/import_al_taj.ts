import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const tenantId = '1057826d-e3ab-4a8c-ba9b-22442f268aa5';

  const { data: globals } = await supabase.from('global_products').select('*').eq('status', 'approved');
  const { data: products } = await supabase.from('products').select('barcode, sku, name').eq('tenant_id', tenantId);
  
  const pBarcodes = new Set(products?.map(p => p.barcode).filter(Boolean));
  const pSkus = new Set(products?.map(p => p.sku).filter(Boolean));
  const pNames = new Set(products?.map(p => p.name).filter(Boolean));
  
  let imported = 0;
  for (const item of globals || []) {
    const hasB = item.barcode && pBarcodes.has(item.barcode);
    const hasS = item.item_code && pSkus.has(item.item_code);
    const hasN = item.name && pNames.has(item.name);
    
    if (hasB || hasS || hasN) continue;

    const { data: newProd, error: pErr } = await supabase
      .from('products')
      .insert({
        tenant_id: tenantId,
        name: item.name,
        barcode: item.barcode,
        sku: item.item_code,
        category: item.category,
        unit: item.unit || 'pcs',
        sell_price: item.default_sell_price || 0,
        cost_price: item.default_cost_price || 0,
        stock: 0,
        is_active: true
      })
      .select('id')
      .single();

    if (!pErr) {
      if (item.barcode) {
        await supabase.from('product_barcodes').insert({
          tenant_id: tenantId,
          product_id: newProd.id,
          barcode: item.barcode
        });
      }
      imported++;
      if (imported >= 200) break; // Small chunk to avoid timeout
    }
  }
  console.log(`Imported ${imported} items.`);
}
run();
