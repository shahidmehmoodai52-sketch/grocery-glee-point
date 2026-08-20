# Performance Optimization Plan: Dashboard, Reports, and Cash Flow

Optimize Dashboard, Reports, and Cash Flow by moving complex aggregations and data derivations from the client to the server (Postgres) using new RPCs and views.

## User Review Required

> [!IMPORTANT]
> This optimization shifts calculations to the server to handle large datasets (100k+ rows) without client-side lag. No data will be truncated or hidden; the "All Time" view will remain accurate.

- **Cash Flow Business Logic Replicated in SQL**: The complex logic that derives "auto" cash entries (Sales -> Cash In, Expenses -> Cash Out) will be implemented in a new SQL View. This is a critical match for existing accounting rules.
- **Side-by-Side Comparison**: The old client-side logic will be kept temporarily during development to verify that server-side results match existing shop data exactly.

## Proposed Changes

### 1. Dashboard Optimization
- **Goal**: Replace 5 heavy client-side fetches (`sales`, `purchases`, `sale_returns`, `products`, `sale_items`) with summary RPCs.
- **New RPCs**:
    - `get_dashboard_timeseries(from, to)`: Aggregates revenue, profit, and returns by day/hour.
    - `get_top_selling_items(from, to, limit)`: Ranks items by revenue.
    - `get_low_stock_products(threshold)`: Returns products below a certain stock level.
    - `get_inventory_value()`: Returns the total current value of all active inventory.
- **Frontend**: Update `dashboard.tsx` to use these RPCs via `useQuery`.

### 2. Reports Optimization
- **Goal**: Enable "All Time" views without downloading up to 500k rows.
- **New RPC**:
    - `get_reports_summary(from, to)`: Returns total revenue, cost, profit, and return stats calculated in the database.
- **Frontend**: 
    - Use the summary RPC for the header metrics.
    - Implement server-side pagination for the detailed table views in `reports.tsx`.

### 3. Unified Cash Flow (Critical)
- **Goal**: Move the "Auto-Derived Ledger" logic (7 separate fetches + complex JS categorization) into a single SQL View/RPC.
- **New Database Objects**:
    - `cash_flow_ledger_view`: A unified view joining `sales`, `purchases`, `expenses`, `returns`, and `party_payments`.
    - `get_cash_flow_summary(from, to)`: Returns aggregated account balances and flow totals.
- **Frontend**:
    - Update `cash-flow.tsx` to pull from the unified view.
    - Implement server-side filtering (by account, method, date) at the query level.
    - Replace client-side summary calculations with `get_cash_flow_summary`.

## Technical Details

- **Database Functions**: New `SECURITY DEFINER` RPCs to ensure tenant isolation (`WHERE tenant_id = public.current_tenant_id()`) while bypassing strict RLS overhead for aggregation.
- **Payment Method Mapping**: The SQL View will replicate the `methodBuckets.resolve` JS logic, mapping payment method strings (e.g., "split:cash=10|bank=20") to the correct accounts.
- **Pagination**: All list views will switch from `fetchAll` (client-side) to standard Supabase `.range()` pagination.

## Verification Plan

1. **Accuracy Check**: Load a shop with existing data. Compare "Revenue", "Profit", and "Cash Balance" totals between the old JS implementation and the new RPCs.
2. **Tenant Isolation**: Verify that data from Shop A never appears in Shop B's summary.
3. **Performance Test**: Measure "Time to Interactive" on the Cash Flow page for a shop with 5,000+ transactions.
4. **Range Testing**: Verify "All Time" vs "Custom Date Range" returns consistent data boundaries.
