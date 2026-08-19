# Performance and Data Integrity Restoration Plan

Restore complete data visibility in reports by removing the 1,000-row preview limitation and fixing date-range logic to respect Pakistan Time (PKT).

## Proposed Changes

### 1. Fix Reports Data Truncation
- Replace truncated `.range(0, 999)` fetches in `src/routes/_authenticated/reports.tsx` with `fetchAll` to ensure all records for the selected period are loaded.
- Remove the "Export All" button and the truncation warning banner since data will now be complete by default.

### 2. Fix PKT Date Range Logic
- Update `range` calculation in `reports.tsx` to handle Pakistan Time correctly.
- Ensure `created_at` filtering uses the full start/end of the day in PKT.

### 3. Supplier Wise Report Fix
- Remove `is_active` references from `reports.tsx` (already fixed in RPC but UI needs cleanup to prevent crashes if it expects it).

## Technical Details

### File: `src/routes/_authenticated/reports.tsx`
- **Modify `sales` query:** Change `await filtered.range(0, 999)` to `await fetchAll<any>((fIdx: number, tIdx: number) => filtered.range(fIdx, tIdx), 1000)`.
- **Modify `purchases` query:** Change `await base.range(0, 999)` to `await fetchAll<any>((fIdx: number, tIdx: number) => base.range(fIdx, tIdx), 1000)`.
- **Modify `expenses` query:** Change `await base.range(0, 999)` to `await fetchAll<any>((fIdx: number, tIdx: number) => base.range(fIdx, tIdx), 1000)`.
- **Modify `partyPayments` query:** Change `await base.range(0, 999)` to `await fetchAll<any>((fIdx: number, tIdx: number) => base.range(fIdx, tIdx), 1000)`.
- **Modify `saleReturns` query:** Change `await base.range(0, 999)` to `await fetchAll<any>((fIdx: number, tIdx: number) => base.range(fIdx, tIdx), 1000)`.
- **Update Range logic:**
  ```typescript
  const range = {
    // Start of fromDate in PKT (+5)
    from: fromDate ? new Date(fromDate.setHours(0, 0, 0, 0)).toISOString() : "2000-01-01T00:00:00Z",
    // End of toDate in PKT (+5)
    to: toDate ? new Date(toDate.setHours(23, 59, 59, 999)).toISOString() : new Date().toISOString(),
  };
  ```
- **Cleanup UI:** Remove `isTruncated` banner, `isExporting` state, and the "Export All" button.

### Rationale
The current implementation caps the preview at 1,000 rows to save initial bandwidth, but this causes reports to be mathematically incorrect (understated totals) for high-volume shops. By using `fetchAll` by default, we restore data integrity. The `fetchAll` utility already has a 500k row safety cap, which is sufficient for current requirements. PKT adjustments ensure records created late in the day (PKT) are correctly captured in the query.
