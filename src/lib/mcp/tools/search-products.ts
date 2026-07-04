import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "search_products",
  title: "Search products",
  description: "Search inventory products by name, SKU, or barcode. Returns id, name, sku, barcode, unit, sell_price, cost_price, and stock.",
  inputSchema: {
    query: z.string().trim().min(1).describe("Search text matched against name, sku, or barcode."),
    limit: z.number().int().min(1).max(50).optional().describe("Max rows to return. Default 20."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const cap = limit ?? 20;
    const like = `%${query}%`;
    const { data, error } = await supabase
      .from("products")
      .select("id,name,sku,barcode,unit,sell_price,cost_price,stock,is_active")
      .or(`name.ilike.${like},sku.ilike.${like},barcode.ilike.${like}`)
      .eq("is_active", true)
      .limit(cap);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { products: data ?? [] },
    };
  },
});
