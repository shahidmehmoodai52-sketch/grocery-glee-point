# Plan - Restore Customer Ledger and Fix Logic

Restore fragmented historical records for shop `hafiz-super-store-ba-023` and ensure the customer ledger logic correctly handles "Cash Out" (debit) vs "Cash Received" (credit).

## User Review Required

> [!IMPORTANT]
> This plan will modify historical ledger entries for shop `hafiz-super-store-ba-023` to link old records from multiple internal IDs into a single unified ledger.

## Proposed Changes

### Database & Data Recovery
- **Unify Fragmented Customers**: Update old `sales`, `party_payments`, and `sale_returns` records from the two previous tenant IDs to point to the current active customer IDs in the `1c951...` tenant.
- **Restore Missing Receipts**: Create `party_payments` records for identified `cash_transactions` that are missing ledger entries (e.g., "From 939G" 860.00).
- **Recalculate Balances**: Run a cleanup script to ensure all customer `opening_balance` and current balances match the reconstructed transaction history.

### Logic & UI Fixes
- **Ledger Logic Audit**: Verify and update `src/lib/customer-ledger.ts` to ensure:
    - **Sales (Credit Sale)**: Increases Debit (In).
    - **Cash Out**: Increases Debit (In) - representing cash given to the customer.
    - **Cash Received**: Increases Credit (Out) - representing payments from the customer.
- **Ledger View Update**: Ensure `src/routes/_authenticated/customers.$id.tsx` correctly displays these categories and that the balance formula `Closing = Opening + In - Out` is consistently applied.

## Technical Details

- **Migration Path**:
    1. Mapping script to identify "matching" customers across tenants (done).
    2. Atomic update to `customer_id` and `tenant_id` for historical rows.
    3. Insertion of missing `party_payments` linked to `cash_transactions`.
- **Logic Invariants**:
    - `debit` = positive impact on receivable (customer owes more).
    - `credit` = negative impact on receivable (customer owes less).
