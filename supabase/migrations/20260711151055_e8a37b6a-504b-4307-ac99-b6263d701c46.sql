
-- Library becomes developer-managed. Shops only consume it.

-- 1) Stop tenants from silently pushing product metadata into the library.
DROP TRIGGER IF EXISTS trg_auto_contribute_global_product ON public.products;

-- 2) Restrict writes on global_products to super-admin (developer). Admins can still review.
DROP POLICY IF EXISTS "auth can contribute" ON public.global_products;
DROP POLICY IF EXISTS "admin can review" ON public.global_products;
DROP POLICY IF EXISTS "super admin manages library" ON public.global_products;

CREATE POLICY "super admin manages library" ON public.global_products
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- 3) Any item uploaded by the developer is approved immediately.
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
  RETURN NEW;
END $$;
