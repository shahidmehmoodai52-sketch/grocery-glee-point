import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function run() {
  const supabase = supabaseAdmin; // It's a Proxy, not a function
  
  console.log("Searching for purchase P-1301...");
  const { data: purchase, error: pError } = await supabase
    .from("purchases")
    .select("id, invoice_no, total, subtotal, paid, supplier_id")
    .eq("invoice_no", "P-1301")
    .single();
    
  if (pError || !purchase) {
    console.error("Purchase P-1301 not found:", pError?.message);
    return;
  }
  
  console.log("Found purchase:", purchase.id, "Total:", purchase.total);
  
  const { data: items, error: iError } = await supabase
    .from("purchase_items")
    .select("id, product_id, qty, cost, name")
    .eq("purchase_id", purchase.id);
    
  if (iError || !items) {
    console.error("Items not found:", iError?.message);
    return;
  }
  
  console.log("Found", items.length, "items.");
  
  // Group by product_id to see if they are actually duplicated
  const productGroups: Record<string, any[]> = {};
  items.forEach(item => {
    const key = item.product_id || item.name;
    if (!productGroups[key]) productGroups[key] = [];
    productGroups[key].push(item);
  });
  
  const toDelete = [];
  const toKeep = [];
  
  for (const key in productGroups) {
    const group = productGroups[key];
    if (group.length > 1) {
      console.log(`Product ${key} (${group[0].name}) has ${group.length} entries.`);
      // Keep one, delete the rest (assuming they are identical duplicates as requested)
      toKeep.push(group[0]);
      for (let i = 1; i < group.length; i++) {
        toDelete.push(group[i]);
      }
    } else {
      toKeep.push(group[0]);
    }
  }
  
  if (toDelete.length === 0) {
    console.log("No duplicates found based on product_id/name.");
    return;
  }
  
  console.log("Deleting", toDelete.length, "duplicate items and adjusting stock...");
  
  for (const item of toDelete) {
    // Delete item
    const { error: delError } = await supabase.from("purchase_items").delete().eq("id", item.id);
    if (delError) {
      console.error(`Failed to delete item ${item.id}:`, delError.message);
      continue;
    }
    
    // Reverse stock
    if (item.product_id) {
      const { data: prod } = await supabase.from("products").select("stock").eq("id", item.product_id).single();
      if (prod) {
        const newStock = Number(prod.stock) - Number(item.qty);
        await supabase.from("products").update({ stock: newStock }).eq("id", item.product_id);
        console.log(`Adjusted stock for ${item.name}: ${prod.stock} -> ${newStock}`);
      }
    }
  }
  
  // Update purchase totals
  const newSubtotal = toKeep.reduce((acc, item) => acc + (Number(item.qty || 0) * Number(item.cost || 0)), 0);
  
  // If items were truly doubled, we expect newSubtotal to be about half of purchase.subtotal
  const ratio = purchase.subtotal > 0 ? newSubtotal / purchase.subtotal : 1;
  const newTotal = purchase.total * ratio;
  
  console.log(`Updating purchase totals: Subtotal ${purchase.subtotal} -> ${newSubtotal}, Total ${purchase.total} -> ${newTotal}`);
  
  await supabase
    .from("purchases")
    .update({ 
      subtotal: newSubtotal,
      total: newTotal
    })
    .eq("id", purchase.id);
    
  console.log("Done.");
}

run().catch(console.error);
