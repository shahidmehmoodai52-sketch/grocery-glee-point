import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false
  }
});

async function runAudit() {
  const shopCode = "hafiz-super-store-ba-023";
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("code", shopCode)
    .single();
    
  if (!tenant) {
    console.error("Tenant not found");
    return;
  }
  
  const { data: p1301 } = await supabase
    .from("purchases")
    .select("id, invoice_no")
    .eq("invoice_no", "P-1301")
    .eq("tenant_id", tenant.id)
    .single();
    
  if (!p1301) {
    console.error("P-1301 not found");
    return;
  }
  
  const { data: p1301Items } = await supabase
    .from("purchase_items")
    .select("id, product_id, qty, cost, name")
    .eq("purchase_id", p1301.id);
    
  if (!p1301Items) return;
  
  const results = [];
  
  for (const item of p1301Items) {
    const { data: movements } = await supabase
      .from("inventory_movements")
      .select("*")
      .eq("product_id", item.product_id)
      .order("created_at", { ascending: true });
      
    if (!movements) continue;
    
    const p1301Movs = movements.filter(m => 
      (m.reference_id === p1301.id) || 
      (m.description && m.description.includes("P-1301"))
    );
    
    const p1302Movs = movements.filter(m => 
      m.description && m.description.includes("P-1302")
    );
    
    const correctionMovs = movements.filter(m => 
      m.description && (
        m.description.includes("Correction") || 
        m.description.includes("Restoration") || 
        m.description.includes("fix_halve") ||
        m.description.includes("apply_p1301_correction")
      )
    );
    
    // The very first movement related to this mess
    const firstP130X = movements.find(m => 
      (m.reference_id === p1301.id) || 
      (m.description && (m.description.includes("P-1301") || m.description.includes("P-1302")))
    );
    
    let originalQty = 0;
    // We assume the first ever movement of either P-1301 or P-1302 is the original intended qty
    if (firstP130X) {
      originalQty = firstP130X.quantity;
    } else {
      originalQty = item.qty;
    }
    
    let stockBefore = 0;
    if (firstP130X) {
      const idx = movements.indexOf(firstP130X);
      stockBefore = idx > 0 ? movements[idx-1].balance : (firstP130X.balance - firstP130X.quantity);
    }
    
    const p1301Impact = p1301Movs.reduce((sum, m) => sum + m.quantity, 0);
    const p1302Impact = p1302Movs.reduce((sum, m) => sum + m.quantity, 0);
    const prevCorrectionImpact = correctionMovs.reduce((sum, m) => sum + m.quantity, 0);
    
    const netP1301P1302Impact = p1301Impact + p1302Impact + prevCorrectionImpact;
    
    const { data: prod } = await supabase.from("products").select("stock").eq("id", item.product_id).single();
    const currentStock = prod ? prod.stock : 0;
    
    // The correct state is: StockBefore + OriginalQty + (Any legitimate movements AFTER the P1301 mess)
    // Legitimate movements = All movements - (P-1301 impact, P-1302 impact, Correction impact)
    // Correct Stock = Current Stock - (Net Impact - Original Qty)
    const requiredCorrection = -(netP1301P1302Impact - originalQty);
    const expectedFinalStock = currentStock + requiredCorrection;
    
    let flag = "";
    if (originalQty % 1 !== 0) flag += "[Fractional Original] ";
    if (expectedFinalStock % 1 !== 0) flag += "[Fractional Final] ";
    if (p1301Movs.length === 0) flag += "[No P-1301 Mov] ";
    
    results.push({
      product: item.name,
      originalQty,
      stockBefore,
      p1301Impact,
      p1302Impact,
      prevCorrectionImpact,
      netP1301P1302Impact,
      currentStock,
      requiredCorrection,
      expectedFinalStock,
      flag
    });
  }
  
  console.log(JSON.stringify(results, null, 2));
}

runAudit();
