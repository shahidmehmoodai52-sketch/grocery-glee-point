# POS Checkout and Payment Wiring Fixes

Fix critical wiring, state, and printing issues in the POS module to ensure correct payment recording and a streamlined checkout experience.

## User Review Required

> [!IMPORTANT]
> The "Digital + CB" (Cash Back) feature involves a specific accounting flow where a larger digital amount is received and the difference is given back as cash. I will preserve this logic while fixing its UI wiring.
> Silent printing will be implemented to bypass the Tillix preview dialog, triggering the browser's print dialog directly.

- **Staff Payments:** Does the current implementation of recording staff purchases as "expenses" against a person align with your accounting needs, or should they hit a specific ledger account? (I will assume the current expense-based logic is correct but just needs proper wiring).
- **Bank Accounts:** I will remove "Card" from the Bank account list if it's a duplicate, ensuring only actual bank accounts remain there.

## Proposed Changes

### POS Payment Logic & UI
- **Staff Payment Wiring:**
  - Fix state management so selecting "Staff" correctly sets `expense_person_id` and the payment method.
  - Ensure clearing Staff selection resets the associated person state.
  - Verify database payload correctly maps Staff purchases to the `expenses` table via the `complete_sale` RPC.
- **Dedicated Card Button:**
  - Add/Fix a standalone "Card" button in the `PaymentMethodGrid`.
  - Ensure "Card" is recorded as its own payment method, independent of "Bank".
- **Bank Account Cleanup:**
  - Filter out "Card" from the Bank dropdown if it's a duplicate of the standalone Card method.
  - Ensure the Bank dropdown only lists actual bank/digital accounts.
- **Digital + CB (Cash Back) Fix:**
  - Fix the wiring for Digital + CB mode to ensure the "Digital Account" and "Received Amount" fields correctly update the sale payload.
  - Validate calculations to prevent double-counting of amounts.
- **Mutual Exclusion & State Safety:**
  - Ensure switching between Cash, Card, Bank, Staff, and Digital + CB correctly clears stale states (e.g., clearing `expense_person_id` when switching away from Staff).
  - Prevent accidental sale completion when clicking "Exact Amount".

### Printing Workflow
- **Default to "No" Print:**
  - Change the default print setting to "No" so it doesn't automatically trigger.
- **Direct Silent Printing:**
  - Remove the intermediate Tillix invoice preview when clicking "Print".
  - Trigger the browser/system print dialog directly using the `printInvoiceDirect` utility.
- **Transaction Safety:**
  - Ensure printing actions never trigger a sale completion or record creation if the sale isn't already finalized.

### Technical Details
- **File Edits:**
  - `src/routes/_authenticated/pos.tsx`: Major updates to state handlers (`setPaymentRows`, `setPrimaryPaymentMethod`, `handleSale`), payment grid components, and printing logic.
  - `src/lib/pos-payments.ts`: Update `normalizePaymentMethodValue` to strictly distinguish "Card" from "Bank".
- **Database/RPC Audit:**
  - Verify the `complete_sale` RPC handles the `expense_person_id` and `digital_cash_back_mode` flags correctly (Audit shows the RPC already supports these).
- **Concurrency Protection:**
  - Retain and verify the `saleLockRef` to prevent duplicate transactions from rapid clicks.

## Verification Plan

### Automated Tests
- Run existing POS tests if available.
- Inspect console logs during checkout to verify payload structure for each payment method.

### Manual Verification
- **Payment Methods:** Perform test sales for Cash, Card, Bank (with account selection), Staff (with person selection), and Digital + CB. Verify each appears correctly in "Reprint" and "Cash Flow".
- **Switching:** Toggle between all payment methods and verify the UI and payload state remains consistent.
- **Printing:** Complete a sale with Print="No", then click "Print" from the toast or history to verify the direct print dialog (no preview).
- **Exact Amount:** Click "Exact" and verify only the "Paid" input changes, without completing the sale.
