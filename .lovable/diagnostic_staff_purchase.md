# Diagnostic Report: Staff Purchase Cash Flow Duplication

## Root Cause
The duplication (appearing as both IN and OUT in Cash Flow) was caused by a mismatch between how the backend records these transactions and how the frontend `cash-flow.tsx` derived them:

1.  **Backend (RPC):** The `complete_sale` RPC correctly records a staff purchase as an `expense` and a `cash_transaction` (direction: **out**).
2.  **Frontend (UI):** The Cash Flow page has an "Auto-derived" engine (`autoTxs`) that scans the `sales` table. It was incorrectly picking up staff purchases (which are stored in the `sales` table) and projecting them as a "Sale IN" based on the `paid` amount.
3.  **Result:** The UI showed the real **OUT** (from `cash_transactions`) and a projected **IN** (from the virtual sale entry), leading to the "Temp Load" duplication.

## Files to Change
1.  `src/routes/_authenticated/cash-flow.tsx`: Filter out staff purchases from the auto-derivation logic for Sales.

## Validation Plan
1.  **Test Case 1:** Create a new Staff Purchase in POS.
    - Expected: Staff Ledger shows debit. Expense shows entry. Cash Flow shows ONLY one "OUT" entry under the `staff_purchase` category. No "IN" entry.
2.  **Test Case 2:** Verify normal customer sales.
    - Expected: Still appear as "IN" in Cash Flow.
3.  **Test Case 3:** Verify genuine manual Cash Flow entries.
    - Expected: Unaffected.
