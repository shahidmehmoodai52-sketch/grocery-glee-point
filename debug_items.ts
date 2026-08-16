import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function run() {
  const supabase = supabaseAdmin;
  const { data: items } = await supabase
    .from("purchase_items")
    .select("id, product_id, qty, cost, name")
    .eq("purchase_id", "39d983ee-561a-4dd4-b5eb-b601fd1b69a6")
    .order("name");
    
  console.log(JSON.stringify(items, null, 2));
}

run().catch(console.error);
