
## Goal
Create a dedicated super-admin login page and let the super-admin add admin staff with granular permissions controlling shop management (approve, suspend, expiry, password reset).

## New pieces

**1. Dedicated admin login route `/admin-login`**
- Public route, separate from `/auth`.
- Signs in via Supabase; after login checks `is_super_admin(uid)` OR new `admin_staff` membership. If neither → sign out + error.
- Redirects to `/admin` on success.
- `/admin-login` link is unlisted (not shown on landing page); accessible via direct URL only.

**2. Database (migration)**
- New table `admin_staff` (per-user admin panel access):
  - `user_id uuid PK` (FK → `auth.users`)
  - `added_by uuid`, timestamps
- New table `admin_staff_permissions`:
  - `user_id uuid`, `perm text`, PK(user_id, perm)
- Permissions list (fixed keys): `shops.view`, `shops.approve`, `shops.suspend`, `shops.set_expiry`, `shops.reset_password`, `shops.delete`.
- Security-definer helpers:
  - `is_admin_staff(uid)` → true if super_admin OR row in `admin_staff`.
  - `admin_has_perm(uid, perm)` → true if super_admin OR row in `admin_staff_permissions`.
- Grants + RLS: only super_admin can read/write these tables; admin_staff can read own row.

**3. Server functions (`src/lib/admin-staff.functions.ts`)**
- `listAdminStaff` (super-admin only) — list users + their perms.
- `addAdminStaff({ email, password, perms })` — create auth user (or attach existing), insert row + perms.
- `updateAdminStaffPerms({ user_id, perms })`.
- `removeAdminStaff({ user_id })`.
- Existing `resetTenantOwnerPassword`, shop approve/suspend/expiry server fns updated to gate on `admin_has_perm` instead of super-admin-only, so delegated staff can perform actions they were granted.

**4. UI**
- `src/routes/admin-login.tsx` — dedicated login page (branded "Tillix Admin").
- New tab inside `/admin` panel: **"Admin staff"** (visible to super_admin only).
  - Add staff dialog (email + password + permission checkboxes).
  - Table: email, perms, edit, remove.
- Existing shop-management buttons on `/admin` gated by the new perm checks via a small `useAdminPerms()` hook so delegated staff only see actions they have.

**5. Hook**
- `src/hooks/use-admin-perms.ts` — queries `is_admin_staff` + list of granted perms; exposes `canAdmin(perm)`.

## Out of scope
- Billing/user/analytics permissions (only shop management was requested).
- Adding admin login link on the landing page (kept hidden by design).

## Files touched
- **New**: `src/routes/admin-login.tsx`, `src/lib/admin-staff.functions.ts`, `src/hooks/use-admin-perms.ts`, migration.
- **Modified**: `src/routes/_authenticated/admin.tsx` (add staff tab, gate buttons), `src/lib/admin.functions.ts` (perm checks), `src/lib/shop-admin.functions.ts` (perm checks).
