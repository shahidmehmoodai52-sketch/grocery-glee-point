# Performance Audit & Optimization Plan

## Summary
Complete performance audit of the Tillix POS system. Initial analysis reveals several critical "Full Table" fetch patterns that will degrade performance as shop data grows. This plan implements server-side pagination, optimized search, and intelligent caching while strictly preserving business logic and multi-shop isolation.

## Performance Audit Report

### Bottleneck 1: Supplier List & Ledger Calculation
- **Location:** `src/routes/_authenticated/suppliers.index.tsx`
- **Problem:** "Full Table" fetch of `purchases`, `party_payments`, and `purchase_returns` to calculate balances in the list view.
- **Evidence:** `useQuery` calls with no range or limit, fetching thousands of historical rows just to show a list of suppliers.
- **Current Behavior:** Downloads every transaction ever made with every supplier on page load.
- **Proposed Optimization:** Switch to server-side balance tracking or aggregate queries. For the list, fetch only active suppliers and their current `balance` column (derived via DB trigger or calculated once).
- **Risk:** Slight delay in balance accuracy if not synced perfectly.
- **Expected Improvement:** 90% reduction in data transferred on supplier list load.

### Bottleneck 2: Dashboard KPI Data Fetching
- **Location:** `src/routes/_authenticated/dashboard.tsx`
- **Problem:** Fetches entire tables of `sales`, `purchases`, and `sale_returns` for the selected date range to sum totals in JavaScript.
- **Evidence:** `useQuery` fetches without `range()` for ranges like "This Month" or "Last 30 Days".
- **Current Behavior:** JS-side reduction of potentially 10,000+ rows.
- **Proposed Optimization:** Use PostgREST `sum` aggregates or a dedicated `get_dashboard_stats` RPC to return single rows of totals.
- **Risk:** None (business logic remains identical).
- **Expected Improvement:** Drastic reduction in browser memory usage and network payload.

### Bottleneck 3: Reports "Full" Data Loading
- **Location:** `src/routes/_authenticated/reports.tsx`
- **Problem:** Uses `fetchAll` to pull 100% of sales data for the selected range.
- **Evidence:** `fetchAll` loops through all pages of sales/items.
- **Current Behavior:** Can download 500,000 rows if a user selects "All Time".
- **Proposed Optimization:** Implement server-side pagination and only "Fetch All" when the user explicitly requests an export or detailed drill-down. Use aggregate RPCs for the main view.
- **Risk:** User might miss data if pagination isn't intuitive.
- **Expected Improvement:** Prevents browser crashes for high-volume shops.

### Bottleneck 4: Low-Stock Alerts (Already partially optimized)
- **Location:** `src/components/low-stock-alerts.tsx`
- **Problem:** Still polling every 5 minutes with a query that might return 100 rows.
- **Proposed Optimization:** Use `staleTime` and only refetch on product updates (already handled by `useRealtimeSync`).

## Implementation Steps

### Step 1: Database Aggregates
- Create/Optimize RPCs for summary data:
  - `get_supplier_balances()`: Returns supplier list with current net balances.
  - `get_dashboard_summary(from, to)`: Returns pre-aggregated KPI totals.

### Step 2: Server-Side Pagination
- Apply `PAGE_SIZE` and `range()` to:
  - `src/routes/_authenticated/suppliers.index.tsx`
  - `src/routes/_authenticated/sales.tsx` (ensure comparison range is handled efficiently)
  - `src/routes/_authenticated/purchases.tsx`

### Step 3: Optimized Product Search
- Ensure all searches (POS, Purchase, Products) use the same indexed pattern:
  - Exact Barcode/SKU hit first.
  - Prefix name match second.
  - Limit results to 50.

### Step 4: Intelligent Caching
- Configure `staleTime` and `gcTime` for master data (suppliers, categories, cash accounts) to 10+ minutes.
- Ensure `useRealtimeSync` only invalidates specific keys rather than whole categories where possible.

## Verification Plan
1. **Multi-Shop Safety:** Log in with two different shop accounts; verify no data from Shop A appears in Shop B.
2. **Offline Logic:** Force offline mode; verify POS still searches local Dexie and saves sales to sync queue.
3. **Data Integrity:** Compare "Total Revenue" on Reports page before and after optimization for the same date range.
4. **Performance:** Measure "Time to Interactive" on Dashboard with 5,000+ sales records.
