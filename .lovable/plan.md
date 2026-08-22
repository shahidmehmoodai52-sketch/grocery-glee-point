# Audit: Admin Panel Credit Sale drill-down (read-only)

Latest commit audited: `ce84995` (merge of `2b29a47`) vs parent `cea18e7`.

## Findings

| # | Check | Result | Detail |
|---|---|---|---|
| 1 | Files changed | PASS | Only `src/routes/admin_.shops.$id.tsx` (+161 lines) and `src/integrations/supabase/types.ts` (auto-generated regen from an earlier task) plus a plan file move. |
| 2 | DB schema / RPC / migration / analytics changed in this commit | PASS (commit) / FAIL (live DB) | No SQL migration files added or changed. But the live database still carries leftovers from the earlier over-scoped attempt: `public.admin_shop_invoices` exists, and `public.admin_shop_analytics` still contains `credit_sales_total`. Local migration files were reverted; the database was not. |
| 3 | Shared components | PASS | `src/components/ui/stat-card.tsx` untouched in this commit (last touched in `64afafb`, before this task). No other shared component modified. |
| 4 | Data source | PASS | Uses existing `sales` table via the standard client (`supabase.from("sales")` with `customer:customers(name)`). The new RPC is not called anywhere in `src/`. |
| 5 | Pagination | PASS | True server-side: `.range(from, to)` with `count: "exact"`, page size 50, `queryKey` includes `page`. |
| 6 | Shows all credit invoices, not just first 50 | PARTIAL | Pagination reaches every page, so more than 50 are reachable. However the filter is `payment_method = 'credit'` only. The `sales` table has no `payment_status` column (columns: `paid`, `status`, `payment_method`), so credit rows that were later settled are still listed, and partially-paid non-credit invoices are not. Title says "Unpaid Invoices" — the label overstates what is filtered. |
| 7 | Totals/counts and 30-day restriction | PARTIAL | "Showing X to Y of Z" uses the exact server count for the whole shop, all dates — no 30-day limit in the drill-down. The parent Sales tab card it is launched from (`admin_shop_analytics`) is still 30-day-scoped, so the row total and the modal total can differ. No period total (sum of amounts) is shown inside the modal. |
| 8 | Tenant/shop isolation | PASS | Every query filters `.eq("tenant_id", tenantId)` from the route param; the drill-down is rendered inside `SalesTab` for one shop. |
| 9 | Out-of-scope changes in the diff | PASS | Diff is UI-only: `drilldownOpen` state, clickable `credit` row in the payment-method table, new `CreditSalesDrilldown` dialog. No POS, sales/returns, ledger, cash-flow, or purchase code touched. |

## Notes (no action taken)

- `public.admin_shop_invoices` is currently dead and also broken: it selects `s.customer_name` and `s.paid_amount`, which do not exist on `public.sales` — it would error if called.
- Nothing was edited, no commits, no DB changes, no Security Memory change during this audit.

## Optional follow-ups (only if you approve)

1. Drop the orphan `public.admin_shop_invoices` function and revert `credit_sales_total` out of `admin_shop_analytics` (DB-only cleanup of the previous over-scoped attempt).
2. Rename the modal title to "Credit Sales" (drop "Unpaid Invoices") so the label matches the filter — pure UI text.
3. Add a period/total amount line in the modal footer, computed from existing data.
