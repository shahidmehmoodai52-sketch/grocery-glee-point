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
  name: "low_stock",
  title: "List low-stock products",
  description: "List active products whose current stock is at or below the given threshold, ordered by stock ascending.",
  inputSchema: {
    threshold: z.number().int().min(0).max(10000).optional().describe("Stock threshold. Default 5."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows. Default 25."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ threshold, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const t = threshold ?? 5;
    const { data, error } = await supabase
      .from("products")
      .select("id,name,sku,stock,unit,sell_price")
      .eq("is_active", true)
      .lte("stock", t)
      .order("stock", { ascending: true })
      .limit(limit ?? 25);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { threshold: t, items: data ?? [] },
    };
  },
});
