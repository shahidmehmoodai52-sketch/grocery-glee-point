import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function runAudit() {
  const supabase = await supabaseAdmin();
  
  // 1. Get the shop/tenant info
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
  
  // 2. Get P-1301 purchase info
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
  
  // 3. Get all items for P-1301
  const { data: p1301Items } = await supabase
    .from("purchase_items")
    .select("id, product_id, qty, cost, name")
    .eq("purchase_id", p1301.id);
    
  if (!p1301Items) return;
  
  const results = [];
  
  for (const item of p1301Items) {
    // 4. Trace inventory movements for this product
    const { data: movements } = await supabase
      .from("inventory_movements")
      .select("*")
      .eq("product_id", item.product_id)
      .order("created_at", { ascending: true });
      
    if (!movements) continue;
    
    // Find movements related to P-1301 and P-1302
    // P-1301 impact (the original one)
    // P-1302/Duplicate impact (the one that was deleted)
    // Previous Correction Impact (the halving etc)
    
    // P-1301 movements usually have reference = 'P-1301' or similar in description
    const p1301Movs = movements.filter(m => m.reference_id === p1301.id || (m.description && m.description.includes("P-1301")));
    const p1302Movs = movements.filter(m => m.description && m.description.includes("P-1302"));
    const correctionMovs = movements.filter(m => m.description && (m.description.includes("Correction") || m.description.includes("Restoration") || m.description.includes("fix_halve")));
    
    // Original Qty: The first P-1301 movement amount
    const originalQty = p1301Movs.length > 0 ? p1301Movs[0].quantity : item.qty;
    
    // Stock Before P-1301: The balance before the first P-1301 or P-1302 movement
    const firstP130X = movements.find(m => 
      (m.reference_id === p1301.id) || 
      (m.description && (m.description.includes("P-1301") || m.description.includes("P-1302")))
    );
    
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
    
    // Expected Final Stock = Stock Before + Original Qty - (Legitimate movements after P-1301/P-1302/Corrections)
    // Or simpler: Corrected Stock = Current Stock - (Net Impact - Original Qty)
    const requiredCorrection = -(netP1301P1302Impact - originalQty);
    const expectedFinalStock = currentStock + requiredCorrection;
    
    // Flagging
    let flag = "";
    if (originalQty % 1 !== 0) flag += "[Fractional Original] ";
    if (expectedFinalStock % 1 !== 0) flag += "[Fractional Final] ";
    if (p1301Movs.length === 0) flag += "[No P-1301 Mov Found] ";
    
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
