## Kya banega

Aap sirf developer/super-admin banoge. Har shop apna owner + cashiers khud manage karegi — cashier ke liye email nahi chahiye, sirf username + password.

### 1. Developer (aap) ke liye
- Aap ka Gmail sirf `super_admin` role rakhega. `/admin` panel me sab shops ka full control (jo pehle se hai).
- Baaki har jagah (dashboard, POS, products…) aap ko `super_admin` ke naate sab dikhta rahega — abhi bhi wahi behavior hai, koi change nahi.

### 2. Har shop ke owner ke liye — naya `/shop-admin` page
Shop registration ke waqt owner (admin) apni email + password se signup karega, jaise abhi. Uske baad `/shop-admin` par 3 tabs:

- **Staff** — apne cashiers add karo (username + password), permissions checkboxes se, reset password, remove.
- **Shop settings** — shop ka naam, phone, address (jitna abhi `store_settings` me bunty hai — subset).
- **Subscription** — current plan aur expiry read-only (details ke liye developer se contact).

Sidebar me ye link sirf shop admin ko dikhega (super_admin ko nahi, kyunki uska apna `/admin` hai).

### 3. Cashier login — username + password (email nahi)
- Owner cashier banate waqt sirf **username** (jaise `raza`) aur **password** likhega.
- Backend me internal email banega: `<username>@shop-<tenantId8>.local` (user ko kabhi dikhega nahi).
- Login screen (`/auth`) par naya toggle: **"Shop staff login"** vs **"Owner / developer login"**.
  - Shop staff login: shop code (ya shop dropdown) + username + password. Frontend `<username>@shop-<code>.local` bana kar Supabase ko bhejega.
  - Owner/developer: email + password (jaisa abhi).
- Shop code: har tenant ka short slug (jaise `sm-electronics` ya first 8 chars of tenant id). Owner ko `/shop-admin` me apna code dikhega taake wo cashiers ko de sake.

### 4. Existing shops ko chhor rahe hain
- 4 existing shops jaise hain waise rahenge. Aap ke Gmail se super_admin role add hoga (agar nahi hai to). Baaki data untouched.

## Technical bits

- **Migration:**
  - `tenants` me `code text unique` column add karenge (auto-fill: existing shops ke liye `substr(id::text,1,8)` se).
  - `register_shop` RPC me shop create karte hi ek unique code generate hoga.
  - Naya RPC `create_shop_staff(_username, _password, _perms, _role)` — sirf tenant admin call kar sake, wo internal email bana kar `auth.admin.createUser` ke bajaye ek server function me chalega.
- **Server functions (naye — `src/lib/shop-admin.functions.ts`):**
  - `createShopStaff({ username, password, role, perms })` — caller admin hona chahiye, uske tenant me hi cashier banega.
  - `listShopStaff()`, `resetShopStaffPassword`, `setShopStaffPerms`, `deleteShopStaff` — sab tenant-scoped.
  - Existing `src/lib/users.functions.ts` `super_admin` ke liye reserve — regular admin `/users` route se hata denge (ya `/shop-admin` par forward).
- **Auth page changes (`src/routes/auth.tsx`):**
  - Segmented control: "Shop Staff" | "Owner / Developer".
  - Staff mode: shop code + username + password fields. Submit karte hi `email = username@shop-<code>.local` bana ke `signInWithPassword`.
- **Naya route:** `src/routes/_authenticated/shop-admin.tsx` — Staff / Settings / Subscription tabs.
- **Sidebar:** shop admin ko `/shop-admin` link dikhe, `/users` hata denge normal admin ke liye. Super_admin ko `/admin` (already hai).

## Jo change NAHI hoga
- Existing 4 shops ka data, memberships, ya products — kuch nahi chhedenge.
- Products/sales/expenses ki UI same rahegi.
- Cashier ke email jo already banae ja chuke hain wo bhi kaam karte rahenge (purani migration ke).
