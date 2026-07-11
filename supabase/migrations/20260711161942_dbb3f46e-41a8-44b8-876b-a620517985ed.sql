
-- 1. New columns on global_products
ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS item_code text,
  ADD COLUMN IF NOT EXISTS default_sell_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_cost_price numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_global_products_category ON public.global_products (category);
CREATE INDEX IF NOT EXISTS idx_global_products_item_code ON public.global_products (item_code);

-- 2. Per-tenant category access
CREATE TABLE IF NOT EXISTS public.tenant_library_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category)
);

GRANT SELECT ON public.tenant_library_categories TO authenticated;
GRANT ALL ON public.tenant_library_categories TO service_role;

ALTER TABLE public.tenant_library_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant reads own library categories" ON public.tenant_library_categories;
CREATE POLICY "tenant reads own library categories"
  ON public.tenant_library_categories FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR public.has_role(auth.uid(), 'super_admin')
  );

DROP POLICY IF EXISTS "super admin manages library categories" ON public.tenant_library_categories;
CREATE POLICY "super admin manages library categories"
  ON public.tenant_library_categories FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- 3. Helper: is a category allowed for the current tenant?
CREATE OR REPLACE FUNCTION public.tenant_category_allowed(_tenant uuid, _category text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM public.tenant_library_categories WHERE tenant_id = _tenant)
    OR EXISTS (
      SELECT 1 FROM public.tenant_library_categories
      WHERE tenant_id = _tenant AND category IS NOT DISTINCT FROM _category
    );
$$;

-- 4. Tighten SELECT policy on global_products to respect category access
DROP POLICY IF EXISTS "read approved for approved shops or admin" ON public.global_products;
CREATE POLICY "read approved for approved shops or admin"
  ON public.global_products FOR SELECT
  USING (
    (
      status = 'approved'
      AND EXISTS (
        SELECT 1 FROM public.tenants t
        WHERE t.id = public.current_tenant_id()
          AND t.library_approved = true
      )
      AND public.tenant_category_allowed(public.current_tenant_id(), category)
    )
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- 5. Update bulk_import to respect categories + copy default prices
CREATE OR REPLACE FUNCTION public.bulk_import_from_global_library()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;

  SELECT library_approved INTO v_allowed FROM public.tenants WHERE id = v_tenant;
  IF NOT COALESCE(v_allowed, false)
     AND NOT public.has_role(v_uid, 'admin')
     AND NOT public.has_role(v_uid, 'super_admin') THEN
    RAISE EXCEPTION 'Your shop is not approved for global library access yet';
  END IF;

  WITH inserted AS (
    INSERT INTO public.products
      (tenant_id, name, barcode, category, unit, sell_price, cost_price, stock, is_active)
    SELECT
      v_tenant,
      g.name,
      g.barcode,
      g.category,
      COALESCE(g.unit, 'pcs'),
      COALESCE(g.default_sell_price, 0),
      COALESCE(g.default_cost_price, 0),
      0,
      true
    FROM public.global_products g
    WHERE g.status = 'approved'
      AND g.barcode IS NOT NULL
      AND public.tenant_category_allowed(v_tenant, g.category)
      AND NOT EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.tenant_id = v_tenant
          AND p.barcode = g.barcode
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;

  RETURN v_count;
END $$;

-- 6. Prefill defaults on single-item import
CREATE OR REPLACE FUNCTION public.import_from_global_library(
  _global_id uuid,
  _sell_price numeric DEFAULT 0,
  _cost_price numeric DEFAULT 0,
  _stock numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_allowed boolean;
  g public.global_products%ROWTYPE;
  v_new_id uuid;
  v_existing uuid;
  v_sell numeric;
  v_cost numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;

  SELECT library_approved INTO v_allowed FROM public.tenants WHERE id = v_tenant;
  IF NOT COALESCE(v_allowed, false)
     AND NOT public.has_role(v_uid, 'admin')
     AND NOT public.has_role(v_uid, 'super_admin') THEN
    RAISE EXCEPTION 'Your shop is not approved for global library access yet';
  END IF;

  SELECT * INTO g FROM public.global_products WHERE id = _global_id AND status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Library item not found or not approved'; END IF;

  IF NOT public.tenant_category_allowed(v_tenant, g.category) THEN
    RAISE EXCEPTION 'This category is not enabled for your shop';
  END IF;

  IF g.barcode IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.products
      WHERE tenant_id = v_tenant AND barcode = g.barcode LIMIT 1;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  v_sell := CASE WHEN COALESCE(_sell_price, 0) > 0 THEN _sell_price ELSE COALESCE(g.default_sell_price, 0) END;
  v_cost := CASE WHEN COALESCE(_cost_price, 0) > 0 THEN _cost_price ELSE COALESCE(g.default_cost_price, 0) END;

  INSERT INTO public.products
    (tenant_id, name, barcode, category, unit, sell_price, cost_price, stock, is_active)
  VALUES
    (v_tenant, g.name, g.barcode, g.category, COALESCE(g.unit, 'pcs'),
     v_sell, v_cost, COALESCE(_stock, 0), true)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END $$;
