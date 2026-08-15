# Production Data Audit & Fix Plan - Tillix POS

## Audit Findings
1.  **Sales Data (Day 1 - Today):** Confirmed via database audit that sales data exists starting from 2026-06-24 (Tenant `2c7daaa7-2db4-4eed-b408-bb3fe02b17f3`) and 2026-08-01 (Tenant `1c951f0e-0219-4c9d-9bae-f3132958342d`). Total sales count for the main tenant is 5,082.
2.  **Missing Data Root Cause:**
    *   **Reports Section:** Currently uses standard Supabase `.select()`, which is limited to 1,000 rows. With >5,000 sales, 80% of historical data was being hidden.
    *   **Cash Flow Section:** Although it uses a `fetchAll` helper, the queries are likely hitting the 1,000-row limit in nested or related joins, or the `queryKey` is not properly invalidating when the range changes.
    *   **Sales History:** Similar to Reports, pagination or fetch limits are truncating the view.
3.  **Data Overwrite Audit:** The system uses `client_uuid` for local-to-cloud sync and `upsert` via RPCs. No evidence of overwriting was found, but `updated_at` was missing in some places, leading to confusion about record history.

## Proposed Changes

### 1. Fix Reports Fetching
*   Integrate `fetchAll` in `src/routes/_authenticated/reports.tsx` for all data types (Sales, Sale Returns, Purchases, Expenses, Party Payments).
*   Ensure the "All" date preset correctly fetches everything from the earliest known date.

### 2. Fix Cash Flow Calculations
*   Audit `src/routes/_authenticated/cash-flow.tsx` to ensure `fetchAll` is actually retrieving the full dataset and not just one page.
*   Update calculations to use the complete fetched array for summaries.

### 3. Historical View & Pagination
*   Update `src/routes/_authenticated/sales.tsx` to handle large datasets more efficiently while still allowing access to historical records.
*   Verify RLS policies for all historical tables to ensure tenant isolation is strictly maintained.

### 4. POS Sync Safety
*   Verify `src/lib/offline/pos.ts` sync logic to ensure local caches never overwrite newer server data or delete old records.

## Technical Details
*   Modify `reports.tsx` to use `fetchAll` from `@/lib/supabase-page`.
*   Update `DatePreset` logic to handle unbounded start dates for "All Time".
*   Add database indexes to `sales(tenant_id, created_at)` and `expenses(tenant_id, created_at)` if not already present to speed up full-history queries.

## Verification Plan
*   Check transaction counts in UI matches `psql` counts for specific tenants.
*   Verify "All Time" report total matches the sum of all historical sales in DB.
*   Confirm no data is lost during a simulated offline/online sync cycle.
