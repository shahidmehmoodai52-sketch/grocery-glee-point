# Plan: Fix Customer Ledger Balance Inconsistency

The user reported that the customer list shows one balance (e.g., 500), but the ledger shows another (e.g., 0). This is due to logic mismatch between `customers.index.tsx` and `customers.$id.tsx` regarding how returns and sales payments are calculated.

## User Requirements Checklist
- [ ] Fix balance mismatch between customer list and ledger detail.
- [ ] Ensure payments shown in ledger are reflected in the list balance.
- [ ] Align calculation logic for Sales, Payments, and Returns across both pages.
- [ ] Preserve existing "Navy and Green" theme and project conventions.

## Proposed Changes

### 1. Refactor `summarizeCustomerLedger` helper
- Update `src/lib/customer-ledger.ts` to provide a more robust summary that accounts for on-invoice payments vs standalone payments.

### 2. Update `customers.index.tsx`
- Sync the `customerBalances` calculation to match the logic used in the ledger page.
- Ensure `sale_returns` are correctly subtracted from the debit or added to credit consistently.

### 3. Update `customers.$id.tsx`
- Ensure the ledger entries construction matches the summary logic.
- Verify that `on-invoice` payments and `party_payments` are not double-counted or missed.

## Technical Details
- The current list logic in `customers.index.tsx` calculates debit/credit manually in a `useMemo`.
- The ledger detail in `customers.$id.tsx` builds an `entries` array.
- I will unify this by moving the logic of "mapping database rows to ledger entries" into a shared utility if possible, or at least making the math identical.

## Verification Plan
- [ ] Add a test customer with a sale, a return, and a payment.
- [ ] Check the balance in the list view.
- [ ] Check the balance in the ledger view.
- [ ] Verify both match exactly.
