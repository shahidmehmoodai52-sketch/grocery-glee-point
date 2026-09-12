import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchProducts from "./tools/search-products";
import lowStock from "./tools/low-stock";
import salesSummary from "./tools/sales-summary";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "tillix-pos-mcp",
  title: "Tillix POS",
  version: "0.1.0",
  instructions:
    "Read-only tools for a grocery point-of-sale and inventory app. Use `search_products` to look up items by name, SKU, or barcode; `low_stock` to find items running low; and `sales_summary` for revenue and profit over a recent window.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchProducts, lowStock, salesSummary],
});
