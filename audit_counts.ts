
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function auditShop() {
  console.log(`Auditing all table counts...`);
  
  const tables = ['tenants', 'sales', 'sale_items', 'party_payments', 'customers', 'cash_transactions'];
  
  for (const table of tables) {
    const { count, error } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
    console.log(`Table: ${table} | Count: ${count} | Error: ${error?.message || 'None'}`);
  }
}

auditShop().catch(console.error);
