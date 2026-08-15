# Plan - Fix Cash Flow Card Detail Modal Sizing

The goal is to increase the width and responsiveness of the Cash Flow detail modal to prevent horizontal scrolling on desktop while maintaining responsiveness on smaller screens.

## User Review Required

> [!NOTE]
> This fix only affects the visual layout of the Cash Flow detail windows. No financial logic or data will be changed.

## Proposed Changes

### UI Components

#### Cash Flow Detail Modal
- Update the `DialogContent` in `src/routes/_authenticated/cash-flow.tsx` to use a responsive width.
- Change `max-w-3xl` to a dynamic `w-[95vw] max-w-[1200px]` (or similar sensible maximum).
- Ensure the table inside the modal handles overflow gracefully without forcing the entire modal to scroll horizontally.
- Remove hardcoded width constraints on table cells that might cause clipping.

### Technical Details

- **File:** `src/routes/_authenticated/cash-flow.tsx`
- **Class Changes:**
    - Update `DialogContent` className from `max-w-3xl` to `w-[95vw] max-w-6xl`.
    - Adjust internal table container `max-h-[60vh] overflow-auto` to ensure it handles both axes correctly if needed, but primary focus is preventing horizontal scroll of the modal itself.
    - Review `TableCell` with `whitespace-nowrap` to ensure they don't push the table too wide.

## Verification Plan

### Manual Verification
- Open the Cash Flow section in the app.
- Click on various cards (Opening Balance, In, Out, Cash on Hand).
- Verify the modal opens wider on desktop.
- Verify no horizontal scrollbars appear on standard desktop resolutions (1280px+).
- Resize the browser to mobile width and verify the modal remains usable and fits the screen.
