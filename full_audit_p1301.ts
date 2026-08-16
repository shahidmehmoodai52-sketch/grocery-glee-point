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
  
  const results = [];
  
  for (const item of p1301Items) {
    const { data: movements } = await supabase
      .from("inventory_movements")
      .select("*")
      .eq("product_id", item.product_id)
      .order("created_at", { ascending: true });
      
    if (!movements || movements.length === 0) {
      results.push({
        Product: item.name,
        OriginalP1301Qty: item.qty,
        StockBefore: 0,
        P1301Impact: 0,
        P1302Impact: 0,
        PrevCorrectionImpact: 0,
        NetImpact: 0,
        CurrentStock: 0,
        RequiredCorrection: 0,
        ExpectedFinalStock: 0,
        Flags: "No movements found"
      });
      continue;
    }
    
    // FIND ORIGINAL P130X
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
        m.description.includes("apply_p1301_correction") ||
        m.description.includes("Halving quantity") ||
        m.description.includes("Doubling quantity")
      )
    );
    
    const firstP130X = movements.find(m => 
      (m.reference_id === p1301.id) || 
      (m.description && (m.description.includes("P-1301") || m.description.includes("P-1302")))
    );
    
    let originalQty = 0;
    let stockBefore = 0;
    
    if (firstP130X) {
      originalQty = Number(firstP130X.quantity || 0);
      const idx = movements.indexOf(firstP130X);
      if (idx > 0) {
        stockBefore = Number(movements[idx-1].balance || 0);
      } else {
        stockBefore = Number(firstP130X.balance || 0) - originalQty;
      }
    } else {
      originalQty = Number(item.qty || 0);
      stockBefore = 0;
    }
    
    const p1301Impact = p1301Movs.reduce((sum, m) => sum + Number(m.quantity || 0), 0);
    const p1302Impact = p1302Movs.reduce((sum, m) => sum + Number(m.quantity || 0), 0);
    const prevCorrectionImpact = correctionMovs.reduce((sum, m) => sum + Number(m.quantity || 0), 0);
    
    const netImpact = p1301Impact + p1302Impact + prevCorrectionImpact;
    
    const { data: prod } = await supabase.from("products").select("stock").eq("id", item.product_id).single();
    const currentStock = Number(prod?.stock || 0);
    
    const requiredCorrection = -(netImpact - originalQty);
    const expectedFinalStock = currentStock + requiredCorrection;
    
    let flags = [];
    if (originalQty % 1 !== 0) flags.push("Fractional Original");
    if (expectedFinalStock % 1 !== 0) flags.push("Fractional Final");
    if (p1301Movs.length === 0) flags.push("No P-1301 Mov");
    
    results.push({
      Product: item.name,
      OriginalP1301Qty: originalQty,
      StockBefore: stockBefore,
      P1301Impact: p1301Impact,
      P1302Impact: p1302Impact,
      PrevCorrectionImpact: prevCorrectionImpact,
      NetImpact: netImpact,
      CurrentStock: currentStock,
      RequiredCorrection: requiredCorrection,
      ExpectedFinalStock: expectedFinalStock,
      Flags: flags.join(", ")
    });
  }
  
  console.log("| Product | Original P-1301 Qty | Stock Before P-1301 | P-1301 Impact | P-1302 Impact | Prev Correction Impact | Net P1301/P1302 Impact | Current Stock | Required Correction | Expected Final Stock | Flags |");
  console.log("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |");
  for (const r of results) {
    console.log(`| ${r.Product} | ${r.OriginalP1301Qty} | ${r.StockBefore} | ${r.P1301Impact} | ${r.P1302Impact} | ${r.PrevCorrectionImpact} | ${r.NetImpact} | ${r.CurrentStock} | ${r.RequiredCorrection} | ${r.ExpectedFinalStock} | ${r.Flags} |`);
  }
}

runAudit();
