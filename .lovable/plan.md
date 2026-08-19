# Plan: Fix Purchase Return Issues

The user reported issues in the Purchase Return section. Analysis suggests a mismatch in how purchase returns are handled compared to sales returns, specifically regarding financial attribution and data integrity.

## User Review Required
> [!IMPORTANT]
> I will be updating the backend logic for purchase returns to ensure they correctly impact supplier ledgers and cash flow, similar to how sales returns work.

## Proposed Changes

### Backend (Database Migrations)
- **Refactor `complete_purchase_return` RPC**:
    - Ensure it records a debit entry in the supplier ledger if the return is on credit.
    - Ensure it records a cash transaction (outward) if a refund was issued.
    - Ensure strict tenant isolation.
    - Added `SECURITY DEFINER` and `search_path` for reliability.
- **RLS/Grants**:
    - Ensure `authenticated` role has `GRANT EXECUTE` on the new RPC.

### Frontend (Purchase Returns Page)
- **Fix Data Loading**: Ensure the purchase return list and drill-down show accurate data.
- **Improve Refund Logic**: Ensure the refund amount and payment source are correctly wired to the backend RPC.
- **Validation**: Add client-side checks to prevent invalid returns (e.g., returning more than purchased).

## Technical Details
- Modified RPC: `public.complete_purchase_return(payload jsonb)`
- Impacted Tables: `purchase_returns`, `purchase_return_items`, `products`, `suppliers`, `cash_transactions`.
- Logic:
    1. Validate items and stock.
    2. Insert `purchase_returns` header.
    3. Insert `purchase_return_items` and update product stock (decrement).
    4. If `refund_amount > 0`, insert a `cash_transactions` record linked to the return.
    5. If `total > refund_amount` and a supplier is present, update `suppliers.balance` (decrementing the payable).
