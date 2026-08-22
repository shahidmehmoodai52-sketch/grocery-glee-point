# Plan - Admin Panel Credit Sales UI Improvement

Improve the Tillix Admin Panel by making Credit Sales interactive, allowing admins to view a paginated list of unpaid invoices for a specific shop using existing database tables.

## User Review Required

> [!IMPORTANT]
> This implementation is strictly UI-only and uses existing database tables (`sales`). No new RPCs or schema changes will be introduced.

## Proposed Changes

### Admin Panel UI

#### `src/routes/admin_.shops.$id.tsx`
- Add `CreditSalesDrilldown` component:
  - Fetches data directly from the `sales` table filtered by `tenant_id` and `payment_method = 'credit'`.
  - Implements client-side pagination (50 records per page).
  - Displays invoice number, date, customer name, and total amount.
  - Shows "Showing X-Y of Z" entries.
- Update `SalesTab`:
  - Modify the "Payment method breakdown" table to make the "Credit" row clickable.
  - Add a visual indicator (e.g., cursor-pointer) to the Credit row.
  - Link the click action to open the `CreditSalesDrilldown` modal.

## Technical Details

- **Data Fetching**: Uses standard Supabase `from('sales').select(...)` with `.eq('tenant_id', tenantId).eq('payment_method', 'credit')`.
- **Pagination**: Uses `.range(start, end)` for efficient server-side data retrieval through the Supabase client.
- **State Management**: React `useState` for pagination and modal visibility.
- **Styling**: Tailwind CSS for consistent UI with the existing Admin Panel.

## Constraints & Assumptions

- Relies on the existing `sales` table structure.
- Assumes `payment_method` column contains 'credit' for credit sales.
- No modifications to shared components like `StatCard` to avoid side effects.
