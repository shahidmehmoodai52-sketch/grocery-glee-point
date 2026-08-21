# Admin Panel Upgrade Plan

Upgrade the existing Tillix Admin Panel with improved security, auditability, and operational efficiency while preserving existing business logic and data.

## Phase 1: Security & Audit Infrastructure
- **Admin Action Log**: Create `public.admin_action_log` table (actor, action, tenant_id, entity, before/after states).
- **Audit RPC**: Create `public.log_admin_action` security definer function.
- **Audit Existing Actions**: Update existing admin RPCs (`admin_set_tenant_status`, `admin_set_tenant_plan`, `admin_delete_tenant`, etc.) to log actions automatically.
- **Safer confirmation UX**: Implement `TypedConfirmDialog` component and replace `window.prompt`/`window.confirm` for destructive operations.

## Phase 2: RBAC & Staff Management
- **Bootstrap Super-admin**: Create a secure one-time bootstrap mechanism and remove the hardcoded email trigger `auto_grant_developer_super_admin`.
- **RBAC Enforcement**: Ensure `admin_staff_permissions` are checked in all relevant RPCs and frontend routes.
- **Staff Workflow**: Scoping `/users` properly to selected tenants or redirecting to `/shop-admin`.

## Phase 3: Operational Improvements
- **Tenants Tab**: Implement server-side pagination, search, and status filtering in `admin_list_tenants`.
- **Health Indicators**: Add last activity, subscription expiry, and resource usage (seats/products) to the shop list.
- **Security & Errors**: Add pagination and advanced filtering to Security and Errors tabs.
- **Read-only Support Mode**: Implement a "View Shop" banner-backed read-only impersonation mode (or document blockers if RLS prevents safe implementation).

## Phase 4: Observability & Exports
- **Error Fingerprinting**: Group errors by type and add resolution reasons.
- **Controlled Exports**: Add auditable, tenant-scoped data export capability for admins.

## Technical Details
- **Schema**: `admin_action_log` will be append-only (no update/delete policies).
- **Timezone**: Pakistan Time (UTC+5) for all admin displays.
- **Performance**: Use server-side limits and offsets for all list queries.
- **Isolation**: Tenant RLS policies remain untouched; admin operations continue to use `SECURITY DEFINER` with explicit permission checks.

## Verification Plan
- **Security**: Verify that non-admins cannot access admin routes or RPCs.
- **Audit**: Verify every mutation appears in `admin_action_log`.
- **Isolation**: Confirm super-admin can only manage staff for a shop after explicit tenant selection.
- **Business Logic**: Verify POS and accounting data remain unmodified.
