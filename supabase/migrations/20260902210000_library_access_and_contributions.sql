-- Fix: library_approved defaulted to false, so almost every shop (including
-- every brand-new one straight out of register_shop()) hit a hard wall on
-- the Library page ("Library access not enabled... contact the developer")
-- and could not import anything. It also broke the ALREADY-BUILT
-- fanout_approved_global_product() trigger for the same reason: that
-- trigger only pushes a newly-approved item to tenants WHERE
-- library_approved = true, so with almost every shop defaulted to false,
-- admin-approving a product effectively reached nobody. Fixing this one
-- flag repairs both: new/existing shops can browse+import immediately, and
-- future approvals now genuinely fan out to every real shop, using the
-- existing trigger as-is -- no new fan-out logic needed.
--
-- Existing shops are backfilled to true (unblocking today), but this does
-- NOT retroactively re-run the fan-out for the ~7.6k already-approved items
-- -- that would silently insert thousands of $0-priced, 0-stock rows into
-- every shop's live POS catalog without anyone asking for it. Existing
-- shops can already reach the same result themselves via the existing
-- "Import all" button if they want the full historical catalog.
ALTER TABLE public.tenants ALTER COLUMN library_approved SET DEFAULT true;
UPDATE public.tenants SET library_approved = true WHERE library_approved = false;

-- Shops currently have no way to contribute a product at all: the only
-- global_products RLS policy that permits INSERT is "admins manage
-- library" (admin-only). The BEFORE INSERT trigger
-- (enforce_global_product_insert) already anticipates and safely handles a
-- non-admin submitter -- it force-sets status='pending' and clears
-- reviewed_by/reviewed_at regardless of what the client sends, so a
-- contributing shop can never self-approve -- but nothing ever granted
-- regular tenant members permission to actually perform the insert. This
-- policy closes that specific, narrow gap: any authenticated user
-- belonging to a tenant may insert a row, and (defense in depth, since RLS
-- should not rely solely on the trigger) the WITH CHECK independently
-- blocks a client from spoofing contributed_by_user/contributed_by_tenant
-- as someone else's identity.
CREATE POLICY "tenant members can contribute to library"
  ON public.global_products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_tenant_id() IS NOT NULL
    AND (contributed_by_user IS NULL OR contributed_by_user = auth.uid())
    AND (contributed_by_tenant IS NULL OR contributed_by_tenant = public.current_tenant_id())
  );

-- So a contributing shop can see their own submission's status afterward
-- (pending/approved/rejected) even before/without it being approved --
-- the existing "library read access" policy only ever exposed approved
-- rows to non-admins.
CREATE POLICY "tenant members can view their own contributions"
  ON public.global_products
  FOR SELECT
  TO authenticated
  USING (contributed_by_user = auth.uid());

-- Pre-existing bug surfaced while verifying the above (not introduced by
-- this migration): the "library read access" SELECT policy's OR-clause
-- included has_role(auth.uid(), 'admin') / has_role(auth.uid(),
-- 'super_admin') -- the legacy, UN-tenant-scoped role check. Every shop
-- OWNER is granted the global 'admin' app_role by register_shop() for
-- their own shop's staff management, so in practice this clause let every
-- shop owner on the platform read every OTHER shop's pending/rejected
-- library submissions (confirmed live: a real shop owner could see 80
-- other tenants' pending rows). admin_has_perm(auth.uid(),
-- 'library.manage') -- already the other disjunct -- already covers real
-- platform admins (it internally checks is_super_admin first), so this
-- only removes the leak; no legitimate access is lost.
DROP POLICY IF EXISTS "library read access" ON public.global_products;
CREATE POLICY "library read access" ON public.global_products
FOR SELECT
USING (
  (
    status = 'approved'
    AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = public.current_tenant_id() AND t.library_approved = true)
    AND public.tenant_category_allowed(public.current_tenant_id(), category)
  )
  OR public.admin_has_perm(auth.uid(), 'library.manage')
);
