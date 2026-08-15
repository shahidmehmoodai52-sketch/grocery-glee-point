# POS Workflow Fixes Plan

Fix POS printing logic and accidental invoice-saving issues to improve workflow reliability and user control.

## User Review Required
- **Print Default**: The print prompt will now default to "No". Do you have any specific user roles that *should* still default to "Yes"? (Assumed: No, standardizing to "No" for all).
- **Exact Amount Shortcut**: This button will now only fill the field. The user must explicitly click "Complete Sale" or press F4 to finalize.

## Proposed Changes

### POS Interface (`src/routes/_authenticated/pos.tsx`)

#### 1. Default Print Setting to "No"
- Update `printDefault` logic in `handleSaleInner` (around line 1887) to ensure the safe default is "no" if the setting is missing.
- Ensure the `PrintPromptDialog` (around line 3242) respects this default for initial focus.

#### 2. Fix "Exact Amount" Accidental Submission
- Find the "Exact" button in the payment sidebar (around line 3067).
- Change it to a standard `<Button type="button">` or ensure its `onClick` handler does NOT trigger `handleSale`.
- Currently, it might be inside a form or have a side-effect. I will explicitly ensure it only calls `setTab({ paid: total.toFixed(2) })` and nothing else.

#### 3. One-Click Direct Printing
- Update the "Reprint" button and "Print" buttons in dialogs to call `printInvoiceDirect` which already handles the silent iframe printing.
- Ensure no intermediate "Invoice Viewer" dialog is shown when the user clicks "Print" from a list; it should just trigger the print.

#### 4. Event Handler Audit
- Check `onKeyDown` on the "Paid" input (around line 3058). Currently, it calls `handleSale()` on Enter. I will add a guard or ensure it only happens when the user intended.
- Add a loading/submitting state check to all entry points of `handleSale` to prevent double-submission.

### Receipt Component (`src/components/receipt.tsx`)
- Verify `printInvoiceDirect` doesn't inadvertently trigger any UI flashes or extra confirmations.

## Technical Details
- **Accidental Submission**: The "Exact" button at line 3067 is a plain `button` (default type `submit` if in a form). I will change it to `type="button"`.
- **Print Prompt**: Modify `PrintPromptDialog` to default focus to the "No" button.
- **Workflow Isolation**: Ensure `handleSale` is ONLY called from the "Complete Sale" button and the Enter key on the "Paid" input, with strict guards.

## Validation Plan
1. **Printing**: Complete a sale -> Verify prompt defaults to "No". Click "Yes" -> Verify browser print dialog opens immediately without a Tillix preview.
2. **Exact Amount**: Click "Exact" -> Verify "Paid" amount updates but sale is NOT completed.
3. **Double Click**: Rapidly click "Complete Sale" -> Verify only one invoice is generated.
