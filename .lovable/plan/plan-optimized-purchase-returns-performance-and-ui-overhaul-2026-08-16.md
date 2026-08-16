# Plan - Optimized Purchase Returns Performance and UI Overhaul

Redesign the Purchase Returns section to fix performance degradation (lag/stuck) and scrolling issues on heavy invoices by adopting a high-performance POS-style architecture.

## Proposed Changes

### High-Performance POS-style UI
- Replace the current modal-based return flow with a full-screen dual-pane layout similar to the POS/Purchase entry screens.
- **Left Pane:** Product search, quick action buttons, and return summary (Totals, Refund settings).
- **Right Pane:** The return list (cart) with virtualized scrolling support to handle hundreds of items without DOM lag.
- Implement immediate keyboard navigation (Up/Down to scroll, Enter to select) in the product picker.

### Virtualized Selection & Data Fetching
- Replace standard Radix `Select` components (which render thousands of DOM nodes for large catalogs) with a custom virtualized search/picker component.
- Implement server-side search with debouncing for selecting the "Original Purchase" to avoid loading the entire purchase history into memory.
- Use `useMemo` and specialized hooks to ensure that re-renders only occur for the specific line item being edited, not the entire list.

### Logic & Performance Fixes
- Optimize the `fetchAll` logic to use a background pre-fetching strategy, ensuring the initial page load is near-instant.
- Centralize return math (subtotals, tax, refunds) to a dedicated utility function, avoiding heavy calculation on every keystroke.
- Ensure the "Print" and "Process" actions release the UI thread immediately by using `setImmediate` or `setTimeout` for non-critical state updates.

## Technical Details

- **Components:** Create `ReturnProductPicker` and `ReturnCartList` components in `src/routes/_authenticated/purchase-returns.tsx`.
- **Optimization:** Use `React.memo` for cart rows and `FixedSizeList` (or a CSS-based virtualization strategy) for the return table.
- **Queries:** Modify `purchases-for-return` query to be searchable rather than a full `fetchAll` list.
- **State:** Use a `usePersistentState` hook (similar to Purchases) to ensure a return-in-progress isn't lost if the page reloads.

## User Review Required

> [!IMPORTANT]
> This will change the "New Return" flow from a popup dialog to a full-page view. Does this work for your workflow, or would you prefer to keep the popup format while optimizing only the internals?
