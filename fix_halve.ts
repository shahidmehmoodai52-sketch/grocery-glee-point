import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function run() {
  const supabase = supabaseAdmin;
  const INVOICE_NO = "P-1301";
  
  console.log(`Searching for purchase ${INVOICE_NO}...`);
  const { data: purchase, error: pError } = await supabase
    .from("purchases")
    .select("id, total, subtotal, paid")
    .eq("invoice_no", INVOICE_NO)
    .single();
    
  if (pError || !purchase) {
    console.error("Purchase not found:", pError?.message);
    return;
  }
  
  const { data: items, error: iError } = await supabase
    .from("purchase_items")
    .select("id, product_id, qty, cost, name")
    .eq("purchase_id", purchase.id);
    
  if (iError || !items) {
    console.error("Items not found:", iError?.message);
    return;
  }
  
  console.log(`Halving quantities for ${items.length} items and adjusting stock...`);
  
  let newSubtotal = 0;
  for (const item of items) {
    const oldQty = Number(item.qty);
    const newQty = oldQty / 2;
    newSubtotal += newQty * Number(item.cost);
    
    // Update item qty
    const { error: itemError } = await supabase
      .from("purchase_items")
      .update({ qty: newQty })
      .eq("id", item.id);
      
    if (itemError) {
      console.error(`Failed to update item ${item.id}:`, itemError.message);
      continue;
    }
    
    // Adjust stock
    if (item.product_id) {
      const { data: prod } = await supabase.from("products").select("stock").eq("id", item.product_id).single();
      if (prod) {
        const diff = oldQty - newQty;
        const newStock = Number(prod.stock) - diff;
        await supabase.from("products").update({ stock: newStock }).eq("id", item.product_id);
        console.log(`Stock ${item.name}: ${prod.stock} -> ${newStock} (diff: -${diff})`);
      }
    }
  }
  
  const ratio = purchase.subtotal > 0 ? newSubtotal / purchase.subtotal : 0.5;
  const newTotal = purchase.total * ratio;
  
  console.log(`Updating purchase totals: Subtotal ${purchase.subtotal} -> ${newSubtotal}, Total ${purchase.total} -> ${newTotal}`);
  
  await supabase
    .from("purchases")
    .update({ 
      subtotal: newSubtotal,
      total: newTotal
    })
    .eq("id", purchase.id);
    
  console.log("Correction complete.");
}

run().catch(console.error);
