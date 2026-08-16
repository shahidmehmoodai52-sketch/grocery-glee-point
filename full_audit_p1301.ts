import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false }
});

async function runAudit() {
  const { data: p1301 } = await supabase
    .from("purchases")
    .select("id, invoice_no, tenant_id")
    .eq("invoice_no", "P-1301")
    .limit(1)
    .single();
    
  if (!p1301) return;
  
  const { data: p1301Items } = await supabase
    .from("purchase_items")
    .select("id, product_id, qty, cost, name")
    .eq("purchase_id", p1301.id);
    
  if (!p1301Items) return;
  
  console.log("| Product | Original P-1301 Qty | Stock Before P-1301 | P-1301 Impact | P-1302 Impact | Prev Correction Impact | Net P1301/P1302 Impact | Current Stock | Required Correction | Expected Final Stock | Flags |");
  console.log("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |");

  for (const item of p1301Items) {
    const { data: movements } = await supabase
      .from("inventory_movements")
      .select("quantity, balance, description, reference_id")
      .eq("product_id", item.product_id)
      .order("created_at", { ascending: true });
      
    if (!movements) continue;
    
    let p1301Impact = 0;
    let p1302Impact = 0;
    let correctionImpact = 0;
    let originalQty = 0;
    let firstIdx = -1;

    for (let i = 0; i < movements.length; i++) {
      const m = movements[i];
      const desc = m.description || "";
      const q = Number(m.quantity || 0);
      
      const isP1301 = m.reference_id === p1301.id || desc.includes("P-1301");
      const isP1302 = desc.includes("P-1302");
      const isCorrection = desc.includes("Correction") || desc.includes("Restoration") || desc.includes("fix_halve") || desc.includes("apply_p1301_correction") || desc.includes("quantity");

      if (isP1301) p1301Impact += q;
      if (isP1302) p1302Impact += q;
      if (isCorrection && !isP1301 && !isP1302) correctionImpact += q;

      if ((isP1301 || isP1302) && firstIdx === -1) {
        firstIdx = i;
        originalQty = q;
      }
    }

    let stockBefore = 0;
    if (firstIdx !== -1) {
      if (firstIdx > 0) {
        stockBefore = Number(movements[firstIdx - 1].balance || 0);
      } else {
        stockBefore = Number(movements[firstIdx].balance || 0) - originalQty;
      }
    }

    const netImpact = p1301Impact + p1302Impact + correctionImpact;
    const { data: prod } = await supabase.from("products").select("stock").eq("id", item.product_id).single();
    const currentStock = Number(prod?.stock || 0);
    const requiredCorrection = -(netImpact - originalQty);
    const expectedFinalStock = currentStock + requiredCorrection;

    let flags = [];
    if (originalQty % 1 !== 0) flags.push("Fractional Original");
    if (expectedFinalStock % 1 !== 0) flags.push("Fractional Final");
    if (p1301Impact === 0) flags.push("No P-1301 Mov");
    
    console.log(`| ${item.name} | ${originalQty} | ${stockBefore} | ${p1301Impact} | ${p1302Impact} | ${correctionImpact} | ${netImpact} | ${currentStock} | ${requiredCorrection} | ${expectedFinalStock} | ${flags.join(", ")} |`);
  }
}

runAudit();
