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
  name: "sales_summary",
  title: "Sales summary",
  description: "Summarize sales revenue, cost, profit, tax, discount, and invoice count over a recent window in days.",
  inputSchema: {
    days: z.number().int().min(1).max(365).optional().describe("Look-back window in days. Default 7."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const window = days ?? 7;
    const since = new Date(Date.now() - window * 86400_000).toISOString();
    const { data, error } = await supabase
      .from("sales")
      .select("total,cost_total,tax,discount,paid,status,payment_method,created_at")
      .gte("created_at", since);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = data ?? [];
    const sum = (k: string) => rows.reduce((a, r: any) => a + Number(r[k] ?? 0), 0);
    const revenue = sum("total");
    const cost = sum("cost_total");
    const tax = sum("tax");
    const discount = sum("discount");
    const paid = sum("paid");
    const profit = revenue - tax - cost;
    const byMethod: Record<string, number> = {};
    rows.forEach((r: any) => {
      byMethod[r.payment_method] = (byMethod[r.payment_method] ?? 0) + Number(r.total ?? 0);
    });
    const summary = {
      window_days: window,
      since,
      invoices: rows.length,
      revenue,
      cost,
      profit,
      tax,
      discount,
      paid,
      revenue_by_payment_method: byMethod,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary,
    };
  },
});
