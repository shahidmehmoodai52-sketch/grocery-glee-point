# Plan: Supplier Wise Sale Report & Cash Flow Enhancements

Implement a new "Supplier / Company Wise Sale" report and add a category filter to Cash Flow with split-payment awareness.

## User Review Required

> [!IMPORTANT]
> - The new report will be added as a tab in the existing Reports page.
> - "Company" is synonymous with "Supplier" in this context, using the `preferred_supplier_id` on products.
> - Split payments in Cash Flow will correctly allocate partial amounts to their respective accounts.

- Do you have a specific list of companies separate from the "Suppliers" table, or should we use the `suppliers` table as the source for the "Company" filter? (Assumed: Use `suppliers` table).
- Should "Company Wise Sale" exclude "Walk-in" customers, or is it strictly based on the product's supplier? (Assumed: Based on product's supplier regardless of customer).

## Proposed Changes

### Database & Backend
- No schema changes required.
- Use existing `sales`, `sale_items`, `products`, and `suppliers` tables.
- RLS is already active; queries will naturally respect `tenant_id`.

### Reports Page (`src/routes/_authenticated/reports.tsx`)
- Add a new tab: "Supplier Wise".
- Add a Supplier dropdown (combobox/searchable select).
- Implement a `useMemo` hook to calculate:
    - Total sales for the selected supplier.
    - Total quantity sold.
    - Number of unique products sold.
    - Number of invoices involved.
- Implement a product breakdown table for the selected supplier:
    - Columns: Product, Qty Sold, Total Sale, % of Supplier Sale.
    - Sorting by Quantity and Amount (High to Low / Low to High).
- Add "Product Details" in the breakdown:
    - Category, Average Sale Price, Invoice Count.
    - Current Stock and Stock Value (from `products` table).
- Ensure Date Filtering applies to these calculations.
- Add a "Top Selling Products" ranking card.

### Cash Flow Page (`src/routes/_authenticated/cash-flow.tsx`)
- Add a "Payment Method / Account" dropdown to the detail dialogs.
- Update `autoTxs` logic to ensure split payments are correctly handled (this seems already partially implemented but will be verified).
- Update the Detail Dialog to show matching transactions for the selected category/account.
- Show summary: Invoice count and Total for the filtered view.

### UI/UX
- Maintain the existing Navy/Green design system.
- Ensure responsive layouts for mobile.
- Use `fmtMoney` and `fmtQty` for consistent formatting.

## Technical Details
- Use `useQuery` to fetch suppliers for the dropdown.
- Use `useMemo` for client-side aggregation of the already fetched `sales` data (which includes `sale_items`).
- Ensure `sale_items` includes `product_id` to join with the `products` table (or verify if the supplier ID is already available in the item data). *Correction: `sale_items` doesn't have supplier ID, need to map `product_id` to its supplier.*

## Acceptance Criteria
- [ ] Select a Supplier -> Correct total sales shown.
- [ ] Product breakdown table appears with correct stats.
- [ ] Sorting by Qty/Amount works.
- [ ] Date filtering updates supplier totals.
- [ ] Cash Flow detail dialog allows filtering by Payment Method.
- [ ] Split payments are correctly split in the filtered view.
- [ ] Data is strictly isolated by `tenant_id`.
