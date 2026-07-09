
## Kya banega

### 1. Public signup + admin approval flow
- Naya shop signup karte hi tenant `status = 'pending'` me create hoga (abhi `active` me hota hai).
- Pending shops ke owner/staff `SuspendedGate` se milta-julta ek "Awaiting approval" screen dekhenge (pehle se hai — bas default status change karna hai).
- Admin panel me "Pending" filter me sab naye shops dikhenge — admin **Approve** kare to `active` ho jaye.

### 2. Har shop ka apna page (folder) admin panel me
Naya route: `/admin/shops/$id` — Tenants table me shop name ya "View" click karne se yahan aayenge. URL bookmark ho sakta hai, back-forward chalta hai. Andar 5 tabs:

- **Overview** — shop info, owner, dates, quick stats (products, customers, sales count, revenue, last sale, low stock count)
- **Sales & Revenue** — last 30 din ka daily sales chart, top 10 products, payment method breakdown
- **Staff** — sab team members (name, email, role, joined), owner ke password reset ka button
- **Subscription & Plan** — current plan, expiry, change plan dialog (plan + expiry date choose kare)
- **Activity** — recent errors + audit log entries (last 50)

Sab **read-only** — sirf 3 actions allowed: approve/suspend/archive (already hai), plan change, password reset. Products/sales/expenses ko admin edit nahi karega.

### 3. Owner password reset
Server function `resetTenantOwnerPassword` — super_admin check karke `supabaseAdmin.auth.admin.updateUserById` se password set kare. Admin ek naya password type kare, use owner ko share kar de.

### 4. Plan/subscription change
Naya RPC `admin_set_tenant_plan(_tenant_id, _plan_id, _expires_at)` — active subscription cancel karke naya banaye (ya update kare). Dialog me plan list + expiry picker.

## Technical bits

- **Migration:** `handle_new_user` / tenant-creation code me default status `'pending'`. Existing 4 tenants ko `active` chhorenge.
- **RPCs added:**
  - `admin_set_tenant_plan(_tenant_id uuid, _plan_id uuid, _expires_at timestamptz)`
  - `admin_shop_analytics(_tenant_id uuid, _from date, _to date)` — returns jsonb with daily sales, top products, payment breakdown
- **Server function:** `src/lib/admin.functions.ts` — `resetTenantOwnerPassword({ tenant_id, new_password })` with `requireSupabaseAuth` + super_admin check.
- **Frontend files:**
  - New: `src/routes/_authenticated/admin.shops.$id.tsx`
  - Edit: `src/routes/_authenticated/admin.tsx` — Tenants row click navigates to detail page, remove modal
  - Edit: `src/routes/auth.tsx` — signup ke baad "pending approval" message dikhaye

## Jo change NAHI hoga
- Products, sales, expenses, customers, suppliers ka data admin edit nahi kar sakega (aap ne "Data edit/delete" select nahi kiya).
- Existing shops (4) `active` hi rahenge — sirf naye signup pending honge.
