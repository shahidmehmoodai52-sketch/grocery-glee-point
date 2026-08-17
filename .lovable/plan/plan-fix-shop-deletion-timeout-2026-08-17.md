# Plan - Fix Shop Deletion Timeout

The user is experiencing a "canceling statement due to statement timeout" error when trying to delete a shop. This usually happens when a shop has a large amount of data (sales, products, etc.) and the deletion process exceeds the default database timeout. Although a batched deletion migration was previously added, the timeout might still be triggered during the initial analysis or within specific large tables.

## Proposed Changes

### Database Migration
- Update the `admin_delete_tenant` RPC to more aggressively handle timeouts.
- Explicitly set `statement_timeout` to `0` (infinity) at the start of the function.
- Increase the batch size or adjust the deletion order to ensure the most data-heavy tables are handled efficiently.
- Add more robust error logging or progress tracking if possible within the PL/pgSQL function.

### Frontend Enhancements (Optional but recommended)
- Add a "Delete" button specifically for "Super Admin" in the admin panel if it's currently hidden for certain roles.
- Improve the deletion confirmation UI to warn about potential timeouts for large shops.

## Technical Details
- Create a new migration to replace the existing `admin_delete_tenant` function.
- The new function will include:
  ```sql
  SET LOCAL statement_timeout = '0';
  SET LOCAL lock_timeout = '0';
  ```
- It will also use a smaller batch size (e.g., 500 instead of 1000) for extremely large tables to avoid long-held locks, or keep it at 1000 but ensure the loop is tight.
- Ensure all relevant tables with `tenant_id` are included in the deletion loop.

## Verification Plan
- Deploy the migration.
- (Self-Correction/Verification): Since I cannot easily simulate a massive shop with thousands of rows in the sandbox without affecting performance, I will verify the SQL syntax and the presence of timeout-suppressing commands.
- Inform the user to retry the deletion.
