# Admin Panel Improvement Plan

This plan focuses strictly on auditing and improving the **Tillix Developer/Admin Control Panel**. It follows the absolute scope rule: **no changes will be made to any shop-side POS or business logic**.

## Audit Findings Summary

Current state of the Admin Panel:
- **Navigation:** Split between `/admin` (dashboard/lists) and `/admin_/shops/$id` (shop detail).
- **Dashboard:** Features top-level stats (Shops, Active, Pending, Suspended) and tabs for Tenants, Library, Printers, Staff, Security, and Errors.
- **Shop Detail:** Detailed overview, daily revenue (30d) bar chart, top products, payment breakdown (with Credit drill-down), staff management, and plan management.
- **Security & Errors:** Centralized logging and error tracking with basic auto-remediation.

### Identified Improvements
1.  **Dashboard Overhaul (P0/P1):** The current `/admin` landing page lacks a high-level "System Health" overview.
2.  **Shop Search & Filtering (P1):** Shop list is server-rendered but filtering is client-side. Performance might degrade with many shops.
3.  **Revenue Visibility (P1):** Revenue stats in the main list are basic. Admin needs better period-based revenue tracking.
4.  **Audit Logs (P2):** Activity logs exist in the database (`admin_action_log`) but visibility in the UI is basic.
5.  **UX Consistency (P2):** Tabs are heavily used; some layouts could be cleaner for mobile/tablet.

---

## Proposed Improvement Plan

### P0 — Critical (Data & Security)
- **Tenant Isolation Check:** Ensure no leaks in cross-tenant data visibility within Admin tools (verified in existing RPCs, but UI checks needed).
- **Error Remediation:** Improve the visibility of "Critical" vs "Warning" errors.

### P1 — High (Core Admin Features)
- **Enhanced Admin Dashboard:** Add a "System Status" summary at the top of `/admin`.
- **Advanced Shop Filters:** Add filters for "Expired/Expiring Soon" and "High Revenue" shops.
- **Revenue Overview:** Add a global revenue chart (last 30 days) to the main Admin dashboard.

### P2 — Medium (UI/UX & Productivity)
- **Clickable Stat Cards:** Ensure all StatCards on the main dashboard link to relevant filtered views.
- **Improved Shop Detail Navigation:** Cleaner layout for the Shop Detail header and actions.
- **Audit Trail UI:** Better visual representation of `admin_action_log` entries.

---

## Technical Details

### Affected Files
- `src/routes/admin.tsx`: Main dashboard and tabs.
- `src/routes/admin_.shops.$id.tsx`: Shop detail page.
- `src/components/ui/stat-card.tsx`: Possible minor styling/prop updates.

### Database & Logic
- **No new tables** will be created.
- **No existing shop logic** will be touched.
- **RPC Reuse:** Existing `admin_list_tenants`, `admin_shop_analytics`, and `admin_security_summary` will be reused.

---

## Safety Declaration

**No code changes were made.** This is an audit and planning document. 

I am waiting for approval before implementing any of these improvements.
