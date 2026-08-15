# Plan: Purchase Workflow Enhancements & Persistence Fixes

Fix critical functional issues in the Purchase section, specifically around editing persistence, unified form handling, multiple draft support, and workflow logic.

## User Review Required

> [!IMPORTANT]
> - Existing purchase average cost recalculation is currently skipped during edits (updates only the invoice and stock). I will preserve this behavior unless instructed otherwise.
> - Multi-draft support will use `localStorage` for offline resilience, consistent with the existing `usePersistentState` pattern.

## Proposed Changes

### 1. Purchase Edit & Persistence
- **Fix Persistence**: Update the edit logic to ensure all fields (date, supplier, payment source, items) are saved to the database.
- **Unified Form**: Refactor `src/routes/_authenticated/purchases.tsx` to use a single `PurchaseDialog` component for both "New" and "Edit" modes. This ensures consistent UI and behavior.
- **Stock Integrity**: Ensure editing quantity correctly adjusts stock levels (delta-based) and handles item deletions.

### 2. Multi-Draft Support
- **Support Multiple Drafts**: Change `purchase-entry-saved` from a single object to an array of draft objects.
- **Unique Identification**: Assign each draft a unique ID (or use a timestamp) to prevent overwriting.
- **Draft Management**: Add a list view in the UI to select from multiple saved drafts.

### 3. Workflow Logic Improvements
- **Keep Editing**: Update the "Keep Editing" button in confirmation dialogs to simply close the confirmation without triggering any state transitions (like moving to draft).
- **Draft Isolation**: Ensure drafts are partitioned by `tenant_id` to prevent cross-shop visibility in multi-tenant environments.
- **Explicit Save**: Ensure "Save Draft" is an explicit user action.

### 4. Technical Details
- **State Management**: Consolidate `draft` and `editRow` states into a unified `activePurchase` state with a `mode` flag (`create` | `edit`).
- **Database Consistency**: Verify that `purchase_items` are correctly synced during edits (delete removed, update existing, insert new).
- **RLS Compliance**: Ensure all operations continue to respect Row Level Security via the current tenant context.

## Verification Plan

### Automated Tests
- N/A (Standard manual verification via browser preview).

### Manual Verification
1. **Edit Flow**: Open an old purchase, change date and qty, save, and reopen to verify persistence.
2. **Draft Flow**: Save two different drafts, verify both appear in the draft list, and resume each one successfully.
3. **Workflow Flow**: Click "Record purchase", then "Keep editing", and verify the form remains open and no draft was created.
4. **Security Flow**: (Simulated) Ensure drafts from one shop session don't appear in another.
