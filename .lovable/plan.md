# Plan: Fix Staff Purchase Cash Flow Duplication

Identify and prevent staff purchases from appearing as duplicate "IN" and "OUT" entries in the Cash Flow module.

## User Review Required

> [!IMPORTANT]
> This change only affects how **Staff Purchases** are displayed in the Cash Flow report. It ensures that when a staff member makes a purchase, it is correctly treated as a shop expense (Cash OUT) without a corresponding fake "Sale IN" entry.

## Proposed Changes

### Frontend (Cash Flow)

#### [src/routes/_authenticated/cash-flow.tsx]
- Modify the `autoTxs` logic to skip derivation for sales that have an `expense_person_id`.
- This ensures that staff purchases, which are already explicitly recorded as "OUT" transactions by the backend, are not duplicated by the "Sale IN" auto-deriver.

## Technical Details

- **Root Cause**: The `autoTxs` `useMemo` in `cash-flow.tsx` iterates over all sales with `paid > 0` and projects an "in" movement. Since staff purchases are recorded in the `sales` table with a `paid` amount but are physically a shop expense (net zero cash or cash out for the item cost), they shouldn't be counted as revenue inflow.
- **Data Flow**:
  1. `complete_sale` RPC -> `sales` (has `expense_person_id`)
  2. `complete_sale` RPC -> `cash_transactions` (direction: 'out', category: 'staff_purchase')
  3. `cash-flow.tsx`:
     - Reads explicit `cash_transactions` -> Shows **OUT** (Correct).
     - Derives from `sales` -> Filters out `expense_person_id` -> Skips **IN** (Correct).

## Verification Plan

### Automated/Manual Tests
- **Staff Sale**: Perform a sale in POS with a staff member selected. Verify Cash Flow shows exactly one OUT transaction.
- **Normal Sale**: Perform a regular sale. Verify Cash Flow shows exactly one IN transaction.
- **Offline Sync**: Verify that an offline staff sale, when synced, follows the same rules via the `complete_sale` RPC.
