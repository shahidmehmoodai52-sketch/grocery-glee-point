# Plan: Editable and Clickable Supplier Ledger Lines

The user wants to make every line/invoice in the supplier ledger editable and clickable, similar to how it works in the customer ledger.

## Proposed Changes

### 1. Update `src/routes/_authenticated/suppliers.$id.tsx`
- Refactor how ledger entries are built to use a shared utility (or improve the local logic) to include `id` and `entity` information for all transaction types.
- Update the ledger table to make rows clickable.
- Ensure the `EditPaymentDialog` and `EditEntryDialog` are correctly wired for all ledger lines.
- Add an "Edit" button to each row for clarity, matching the customer ledger UI.

### 2. Standardize Ledger Entry Building
- Check if `src/lib/customer-ledger.ts` can be generalized or if a similar `src/lib/supplier-ledger.ts` should be created to ensure consistent `entity` and `id` mapping.
- Currently, `suppliers.$id.tsx` builds entries manually. I will update it to match the robust `buildLedgerEntries` pattern used in customers.

## Technical Details
- **Row Click Handling**: Add an `onClick` handler to `TableRow` that opens the appropriate edit dialog based on the entry type.
- **Action Buttons**: Ensure `Pencil` icons are present for all editable rows.
- **Dialog Integration**: Reuse `EditPaymentDialog` for payments and `EditEntryDialog` for purchases and returns.

## Verification Plan
- Navigate to a supplier's ledger.
- Click on a purchase row; verify the edit dialog opens.
- Click on a payment row; verify the edit payment dialog opens.
- Click on a return row; verify the edit dialog opens.
- Save a change in each dialog and verify the ledger updates.
