# Plan - Expenses Clickable and Editable

Enable clicking on cards and table rows in the Expenses section to edit details.

## User Review Required

> [!IMPORTANT]
> - Clicking an **Expense Entry** row or card will open the "Record Expense" dialog pre-filled with that entry's data for editing.
> - Clicking a **Person** row or card will open the "Add Expense Person" dialog pre-filled for editing.

- **Goal**: Make every card and row in the Expenses section clickable and editable.
- **Target Users**: Shop admins and staff managing expenses.
- **Pages**: `src/routes/_authenticated/expenses.tsx`.
- **Features**: 
    - Row-level clicks for editing entries.
    - Card-level clicks for viewing/editing summary data.
    - Dialog reuse for both "Create" and "Edit" modes.

## Technical Details

- **State Management**:
    - Add `editingId` and `editingPersonId` state to track which record is being modified.
    - Update `saveExpense` and `savePerson` to handle updates via `.upsert()` or `.update()`.
- **UI Components**:
    - Wrap `TableRow` and `Card` content in clickable containers or add `onClick` handlers.
    - Add visual feedback (cursor-pointer, hover states) to indicate clickability.
    - Update Dialogs to dynamically change titles (e.g., "Record Expense" vs "Edit Expense").
- **Data Handling**:
    - Ensure offline-first persistence is maintained for edited records using `insertOfflineAware` (which typically handles upserts if IDs are present).
