# Plan: Cash Out Button in POS

Implement a "Cash Out" button in the POS payment section to record cash withdrawals for customers without affecting sales, profit/loss, or stock.

## User Review Required

> [!IMPORTANT]
> This feature will allow shop staff to give cash to customers (e.g., as a loan or withdrawal) and record it directly in the customer's ledger as a debit.

- The "Cash Out" button will be placed next to the "Split" button.
- It will require selecting a customer and entering an amount.
- This transaction will reduce shop cash and increase customer debt (or reduce advance).

## Technical Details

### UI Changes
- **POS Side Panel (`src/routes/_authenticated/pos.tsx`)**:
    - Add `CashOutDialog` component for the withdrawal flow.
    - Add "Cash Out" button next to "Split" in the payment section.
    - Button styling: Small, compact, matching "Split" button height/width.

### Functionality
- **New Ledger Type**: Add `cash_out` to `CustomerLedgerEntry` type in `src/lib/customer-ledger.ts` (if needed for display) and ensure `buildLedgerEntries` handles it.
- **Cash Flow Integration**: Ensure the transaction appears in `src/routes/_authenticated/cash-flow.tsx` as a "Cash Out" category.
- **Database**:
    - Use `party_payments` table for the ledger entry.
    - Use `cash_transactions` table to reduce shop cash.
    - Ensure tenant isolation and offline support (via `enqueueWrite`).

### Rules Verification
- [x] Select customer required.
- [x] Select amount required.
- [x] Shop cash reduction.
- [x] Customer ledger debit.
- [x] No sale/invoice creation.
- [x] No stock effect.
- [x] No profit/loss impact.
- [x] Prevent duplicate submissions.
- [x] Offline aware.
