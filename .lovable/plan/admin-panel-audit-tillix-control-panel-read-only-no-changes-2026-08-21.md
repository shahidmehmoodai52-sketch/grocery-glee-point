# Admin Panel Audit — Tillix Control Panel (read-only, no changes made)

Scope: `/admin`, `/admin/shops/$id`, `/users`, `/shop-admin`, supporting hooks, server functions, admin RPCs and RLS policies. Zero code, DB, or data changes were made.

## 1. Current capabilities (verified)

- **Tenants tab** (`admin.tsx` → `TenantsTab`): `admin_list_tenants()` returns all 7 tenants with owner name/email, member/product/sales counts, revenue, plan, subscription status/expiry. Client-side search + status filter, 4 stat cards. Row actions: approve/activate, suspend (reason prompt), archive, delete (type-shop-name confirm, resumable batched `admin_delete_tenant`), inline expiry editor (`admin_set_tenant_expiry`).
- **Shop detail** (`admin_.shops.$id.tsx`): overview + members + subscription (`admin_tenant_detail`), 30-day analytics (`admin_shop_analytics`: daily revenue, top products, payment mix, low stock, expenses), Activity tab (`admin_tenant_audit`, last 100 `audit_logs`), owner password reset (`resetTenantOwnerPassword` server fn, gated on `shops.reset_password`), plan assignment (`admin_set_tenant_plan`), library access grant/revoke + per-category and price-visibility controls (direct table writes under super-admin RLS).
- **Security tab**: `admin_security_summary` cards (24h events, failed logins, critical, active blocks, unique IPs), event log (`admin_list_security_events`, 200 rows, severity filter), blocklist CRUD (`admin_block_identifier` / `admin_unblock_identifier`), log purge (`admin_clear_security_events`).
- **Errors tab**: `admin_recent_errors` (100 unresolved), per-shop grouping, resolve one, "Auto-fix" heuristic, bulk clear (`admin_resolve_errors_bulk`).
- **Admin staff tab** (super-admin only): `admin-staff.functions.ts` CRUD over `admin_staff` + `admin_staff_permissions` with 7 permission keys.
- **Printers tab**: local (per-browser) receipt printer settings — not tenant data.
- **RBAC**: `useAdminAccess` (`am_i_super_admin`, `am_i_admin_staff`, `my_admin_perms`); `admin_has_perm()` = super_admin OR granted perm. RPCs enforce authorization server-side (verified in every function definition), so UI hiding is not the only control.
- **Tenant staff management**: `/shop-admin` (owner-scoped, `callerTenant` verifies `owner_id`), legacy `/users` (`users.functions.ts`, service-role client).

## 2. Critical issues

1. **Legacy `/users` path can attach staff to the wrong tenant — Critical.** `resolveStaffAdmin()` picks the *first* `owner`/`admin` membership found (no ordering), and `attachToTenant()` deletes all of the target user's memberships before inserting one. For a super admin it returns `tenantId: null`, which makes `assertSameTenant()` a no-op and `listStaff` list **every** auth user in the project (perPage 200). Cross-shop staff reassignment and cross-tenant identity exposure are both reachable.
2. **Privileged admin actions are largely unaudited — Critical.** Only `admin_set_tenant_status` writes to `audit_logs`. Owner password reset, plan change, expiry change, tenant delete, library grant/revoke, blocklist add/remove, security-log purge, error bulk-resolve, and admin-staff permission grants leave **no** record. There are 0 `log_audit` triggers in the DB, so business tables aren't audited either; the 12,396 existing `audit_logs` rows come from explicit RPC writes.
3. **Audit trail is not immutable and is destroyed with the tenant — Critical.** `admin_delete_tenant` deletes `audit_logs` for the tenant (ordering key 98) as part of the purge; a super admin can also `admin_clear_security_events()` with no filter, wiping all 238 security events with no counter-record. No append-only guarantee, no retention/export.
4. **Deletion is irreversible with a weak guard — High.** Confirmation is a `window.prompt` name match (case-insensitive on the detail page); no soft-delete window, no export-before-delete, no second approver, no audit entry, and the client loop keeps calling until `done`, so a mid-way network failure leaves the shop partially deleted.
5. **Super-admin grant by hardcoded email — High.** `auto_grant_developer_super_admin()` grants `super_admin` + `admin` to a single literal email on user creation. Anyone who can register that address (or an admin who edits it) becomes platform super admin; the grant itself isn't audited.

## 3. High-value improvements

- **Impersonation / read-only shop view (High).** There is no impersonation at all today; support work is done by querying analytics RPCs or by resetting the owner's password — which locks the owner out and is untraceable. A scoped, time-boxed, reason-required, fully logged read-only "view as shop" is the single biggest operational win and removes the password-reset workaround.
- **Server-side search/filter/pagination (High).** `admin_list_tenants()` returns every tenant with 4 correlated subqueries per row (counts over 8,534 sales) and no LIMIT; the errors tab additionally fetches the full tenant list to build a name map. Fine at 7 tenants, quadratic in cost as shops grow. Same pattern in `listStaff` (`perPage: 200` hard cap) and the security log (fixed 200 rows, no pagination or date range).
- **Tenant health & usage (High).** No last-activity/heartbeat, sync-queue backlog, DB size, seat/product usage vs plan limits, or churn signals in the list. `can_add_product` / `can_add_user` limits exist in the DB but aren't surfaced to admins.
- **Confirmation UX and destructive-action gating (Medium).** `window.prompt`/`confirm` for suspend, archive, delete, and log purges — no typed-confirm dialog, no reason capture for delete/archive/purge, no "requires super admin + second factor" tier.
- **Errors observability (Medium).** "Auto-fix all" loops one RPC per row, marks unrecoverable errors resolved with a cosmetic note, and can silently hide real defects; only 100 unresolved rows visible, no grouping by fingerprint, no trend, no assignment, no unresolve.
- **Subscription/billing state (Medium).** `billing_events` and `subscription_plans` exist but the panel shows only status/expiry text; no MRR, plan mix, expiring-soon queue, or dunning view. Expiry can be set without a plan (creates a `trial` subscription implicitly).
- **Data-export controls (Medium).** No admin-side CSV/JSON export of a tenant's data, and equally no policy/limit or logging around exports.
- **Feature flags (Low/Medium).** Only ad-hoc booleans (`library_approved`, price visibility, category allowlist) written directly from the client; no flag registry or per-plan gating.
- **RBAC in practice (Medium).** `admin_staff` has 0 rows, so every admin operator is effectively a `super_admin` with full destructive power — least privilege exists in code but is unused. Several read RPCs (`admin_tenant_detail`, `admin_tenant_audit`, `admin_shop_analytics`, `admin_list_security_events`) require `super_admin` rather than `shops.view`, so a limited staff member can open `/admin` but the shop detail page redirects them out.
- **Loading/error states (Low).** Skeletons exist; but query errors surface only as empty tables/zeros (no `errorComponent`, no retry affordance), and mutation failures rely on toasts.

## 4. Recommended roadmap

**Phase 1 — safety & traceability**
1. Central `admin_action_log` (append-only: actor, action, tenant, reason, before/after, IP) written inside every privileged RPC and server fn; revoke UPDATE/DELETE on it; exclude it from `admin_delete_tenant`.
2. Require a reason for suspend/archive/delete/plan change/password reset/log purge; replace `prompt`/`confirm` with typed-confirm dialogs.
3. Fix `/users`: scope super admin to an explicitly chosen tenant, make `assertSameTenant` mandatory, stop deleting all memberships blindly — or retire `/users` in favour of `/shop-admin`.
4. Replace the hardcoded-email super-admin trigger with an explicit, audited bootstrap.
5. Make tenant delete two-step: archive → export → hard delete after N days, with audit rows preserved outside the purge.

**Phase 2 — operations**
6. Safe impersonation: read-only, time-boxed, reason-required, banner in UI, every request logged; deprecate password-reset-as-support.
7. Server-side tenant search/sort/pagination (materialised counts or a summary table) + shop lookup by code/email/phone.
8. Tenant health column set (last sale, last login, sync backlog, seats/products vs plan) and an "expiring in 7/30 days" queue.
9. Security log and error list: date range, pagination, fingerprint grouping, resolve/unresolve, no bulk auto-resolve without a reason.

**Phase 3 — scale & product**
10. Billing view (plan mix, expiring, `billing_events` timeline), feature-flag registry per plan, controlled tenant data export with logging, anomaly alerts (failed-login spikes, error bursts, revenue anomalies) pushed rather than polled every 30s.

## 5. What should NOT be changed

- The RPC-level authorization pattern (`is_super_admin` / `admin_has_perm` checked inside `SECURITY DEFINER` functions with `SET search_path`) — it is the correct boundary; keep it and keep RLS super-admin policies as-is.
- Batched resumable `admin_delete_tenant` mechanics (avoids timeouts) — wrap it, don't rewrite it.
- Tenant-scoped RLS on business tables and `current_tenant_id()` semantics.
- The existing visual layout/tab structure; no redesign needed.
- Local printer settings (per-device, intentionally not synced).
- No data migrations or backfills as part of this audit.

## 6. Files / routes / components reviewed

`src/routes/_authenticated/admin.tsx`, `src/routes/_authenticated/admin_.shops.$id.tsx`, `src/routes/_authenticated/users.tsx`, `src/routes/_authenticated/shop-admin.tsx`, `src/routes/_authenticated/route.tsx`, `src/routes/admin-login.tsx`, `src/components/route-guard.tsx`, `src/hooks/use-admin-access.ts`, `src/hooks/use-super-admin.ts`, `src/hooks/use-permissions.ts`, `src/hooks/use-auth.ts`, `src/lib/admin.functions.ts`, `src/lib/admin-staff.functions.ts`, `src/lib/users.functions.ts`, `src/lib/shop-admin.functions.ts`, `src/lib/shop-admin.server.ts`, `src/lib/security-log.ts`, `.lovable/security-memory.md`.

DB objects inspected (read-only): `admin_list_tenants`, `admin_tenant_detail`, `admin_tenant_audit`, `admin_shop_analytics`, `admin_set_tenant_status`, `admin_set_tenant_plan`, `admin_set_tenant_expiry`, `admin_delete_tenant`, `admin_has_perm`, `am_i_admin_staff`, `is_super_admin`, `auto_grant_developer_super_admin`, `admin_recent_errors`, `admin_list_security_events`, `admin_clear_security_events`, `log_audit`; RLS policies on `tenants`, `audit_logs`, `admin_staff`, `admin_staff_permissions`, `user_roles`, `application_errors`, `security_events`, `security_blocklist`, `tenant_subscriptions`, `global_products`, `tenant_library_categories`.
