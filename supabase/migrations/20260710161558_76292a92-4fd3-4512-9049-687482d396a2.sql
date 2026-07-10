
-- 1) Add library access flag on tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS library_approved boolean NOT NULL DEFAULT false;

-- 2) Tighten SELECT policy on global_products: approved items are only
--    visible to shops that the admin has approved for library access.
DROP POLICY IF EXISTS "read approved or own or admin" ON public.global_products;
CREATE POLICY "read approved or own or admin" ON public.global_products
  FOR SELECT TO authenticated
  USING (
    (
      status = 'approved'
      AND EXISTS (
        SELECT 1 FROM public.tenants t
        WHERE t.id = public.current_tenant_id()
          AND t.library_approved = true
      )
    )
    OR contributed_by_user = auth.uid()
    OR contributed_by_tenant = public.current_tenant_id()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- 3) Auto-contribute EVERY product a shop adds (with or without barcode).
--    De-dupe on barcode when present, otherwise on (tenant, lower(name)).
CREATE OR REPLACE FUNCTION public.auto_contribute_global_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bc text := NULLIF(trim(NEW.barcode), '');
  v_name text := NULLIF(trim(NEW.name), '');
  v_exists boolean;
BEGIN
  IF v_name IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_bc IS NOT NULL THEN
    INSERT INTO public.global_products
      (name, barcode, category, unit, status, contributed_by_tenant, contributed_by_user)
    VALUES
      (v_name, v_bc, NEW.category, COALESCE(NEW.unit, 'pcs'), 'pending', NEW.tenant_id, auth.uid())
    ON CONFLICT (barcode) DO NOTHING;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.global_products
       WHERE contributed_by_tenant = NEW.tenant_id
         AND barcode IS NULL
         AND lower(name) = lower(v_name)
    ) INTO v_exists;
    IF NOT v_exists THEN
      INSERT INTO public.global_products
        (name, barcode, category, unit, status, contributed_by_tenant, contributed_by_user)
      VALUES
        (v_name, NULL, NEW.category, COALESCE(NEW.unit, 'pcs'), 'pending', NEW.tenant_id, auth.uid());
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- 4) Require library access on the caller's tenant when importing.
CREATE OR REPLACE FUNCTION public.import_from_global_library(
  _global_id uuid,
  _sell_price numeric DEFAULT 0,
  _cost_price numeric DEFAULT 0,
  _stock numeric DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_g public.global_products%ROWTYPE;
  v_id uuid;
  v_allowed boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;

  SELECT library_approved INTO v_allowed FROM public.tenants WHERE id = v_tenant;
  IF NOT COALESCE(v_allowed, false) AND NOT public.has_role(v_uid, 'admin')
     AND NOT public.has_role(v_uid, 'super_admin') THEN
    RAISE EXCEPTION 'Your shop is not approved for global library access yet';
  END IF;

  SELECT * INTO v_g FROM public.global_products WHERE id = _global_id AND status = 'approved';
  IF v_g.id IS NULL THEN RAISE EXCEPTION 'Global product not found or not approved'; END IF;

  IF v_g.barcode IS NOT NULL THEN
    SELECT id INTO v_id FROM public.products
      WHERE tenant_id = v_tenant AND barcode = v_g.barcode LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  INSERT INTO public.products (tenant_id, name, barcode, category, unit, sell_price, cost_price, stock, is_active)
  VALUES (v_tenant, v_g.name, v_g.barcode, v_g.category, COALESCE(v_g.unit, 'pcs'),
          COALESCE(_sell_price, 0), COALESCE(_cost_price, 0), COALESCE(_stock, 0), true)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- 5) Backfill: contribute existing products that never made it into the library.
INSERT INTO public.global_products (name, barcode, category, unit, status, contributed_by_tenant, contributed_by_user)
SELECT p.name, NULLIF(trim(p.barcode),''), p.category, COALESCE(p.unit,'pcs'), 'pending', p.tenant_id, NULL
FROM public.products p
WHERE NULLIF(trim(p.barcode),'') IS NOT NULL
ON CONFLICT (barcode) DO NOTHING;

INSERT INTO public.global_products (name, barcode, category, unit, status, contributed_by_tenant, contributed_by_user)
SELECT DISTINCT ON (p.tenant_id, lower(p.name))
       p.name, NULL, p.category, COALESCE(p.unit,'pcs'), 'pending', p.tenant_id, NULL
FROM public.products p
WHERE NULLIF(trim(p.barcode),'') IS NULL
  AND NULLIF(trim(p.name),'') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.global_products g
     WHERE g.contributed_by_tenant = p.tenant_id
       AND g.barcode IS NULL
       AND lower(g.name) = lower(p.name)
  );
