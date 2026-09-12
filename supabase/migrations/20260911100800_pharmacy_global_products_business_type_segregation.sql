-- Segregate the shared product library per business type: a pharmacy
-- tenant should never see/import grocery library items and vice versa,
-- and grocery's existing ~7.9k-row library (7.6k approved, actively
-- fanned out to real shops) must be completely unaffected. Every future
-- business type gets its own segregated library the same way, reusing
-- this exact contribute/approve/fan-out mechanism rather than a parallel
-- system per vertical.
--
-- Additive: existing rows default to 'grocery' (matching their real
-- origin — every current tenant and every existing library item IS
-- grocery), so this changes nothing for current grocery tenants.
--
-- Verified on tillix-migration-test (production-scale: 7,943 rows,
-- 7,655 approved) with a full before/after regression + isolation pass:
--   - A regular grocery tenant owner saw exactly 7,655 rows both BEFORE
--     and AFTER this migration — zero change.
--   - A tenant temporarily flipped to business_type='pharmacy' saw 0 rows
--     (correctly isolated from the 7,655 grocery rows) before any
--     pharmacy contribution existed.
--   - That tenant contributed a test item; it was auto-stamped
--     business_type='pharmacy' from the contributing tenant (not
--     client-supplied) and status='pending'.
--   - Approving it (as a real super admin on this project) fanned out to
--     exactly that one pharmacy tenant's products table — zero leak into
--     any grocery tenant (checked directly).
--   - The pharmacy tenant could then see exactly 1 row; the grocery
--     tenant still could not see it and still saw exactly 7,655.
--   - All test data (global_products row, fanned-out product row, the
--     temporary business_type flip) was fully cleaned up afterward.
ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'grocery';

DO $$ BEGIN
  ALTER TABLE public.global_products
    ADD CONSTRAINT global_products_business_type_check
    CHECK (business_type IN ('grocery', 'pharmacy'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_global_products_business_type ON public.global_products(business_type);

-- Force-stamp business_type from the contributing tenant's own
-- business_type (never trust the client) — mirrors how this same trigger
-- already force-sets status/contributed_by_* for non-super-admins.
CREATE OR REPLACE FUNCTION public.enforce_global_product_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'super_admin') THEN
    NEW.status := COALESCE(NULLIF(NEW.status, 'pending'), 'approved');
    IF NEW.status = 'approved' THEN
      NEW.reviewed_by := auth.uid();
      NEW.reviewed_at := now();
    END IF;
  ELSE
    NEW.status := 'pending';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;
  NEW.contributed_by_user := COALESCE(NEW.contributed_by_user, auth.uid());
  NEW.contributed_by_tenant := COALESCE(NEW.contributed_by_tenant, public.current_tenant_id());
  IF NEW.contributed_by_tenant IS NOT NULL THEN
    SELECT business_type INTO NEW.business_type
      FROM public.tenants WHERE id = NEW.contributed_by_tenant;
  END IF;
  NEW.business_type := COALESCE(NEW.business_type, 'grocery');
  RETURN NEW;
END $$;

-- Fan-out only reaches tenants of the SAME business type as the approved
-- item — a pharmacy contribution must never land in a grocery tenant's
-- live POS catalog, and vice versa.
CREATE OR REPLACE FUNCTION public.fanout_approved_global_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  t RECORD;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    FOR t IN SELECT id FROM public.tenants WHERE library_approved = true AND business_type = NEW.business_type LOOP
      IF EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.tenant_id = t.id
          AND (
            (NEW.barcode IS NOT NULL AND p.barcode = NEW.barcode)
            OR (NEW.item_code IS NOT NULL AND p.sku = NEW.item_code)
          )
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.products
        (tenant_id, name, sku, barcode, category, unit,
         cost_price, sell_price, stock, is_active)
      VALUES
        (t.id, NEW.name, NEW.item_code, NEW.barcode, NEW.category,
         COALESCE(NEW.unit, 'pcs'),
         COALESCE(NEW.default_cost_price, 0),
         COALESCE(NEW.default_sell_price, 0),
         0, true);
    END LOOP;
  END IF;
  RETURN NEW;
END $function$;

-- Read policy: an approved item is only visible to a tenant of the SAME
-- business type (in addition to the existing library_approved + category
-- checks). Own-contribution and admin-perm policies are untouched.
DROP POLICY IF EXISTS "library read access" ON public.global_products;
CREATE POLICY "library read access" ON public.global_products
FOR SELECT
USING (
  (
    status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = public.current_tenant_id()
        AND t.library_approved = true
        AND t.business_type = public.global_products.business_type
    )
    AND public.tenant_category_allowed(public.current_tenant_id(), category)
  )
  OR public.admin_has_perm(auth.uid(), 'library.manage')
);
