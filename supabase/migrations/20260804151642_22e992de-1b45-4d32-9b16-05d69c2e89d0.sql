CREATE OR REPLACE FUNCTION public.enforce_product_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  -- Global library imports are always allowed, on any plan (incl. free trial).
  IF coalesce(current_setting('app.library_import', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS NOT NULL AND NOT public.can_add_product(NEW.tenant_id) THEN
    RAISE EXCEPTION 'Product limit reached for your current plan. Please upgrade to add more products.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.import_from_global_library(_global_id uuid, _sell_price numeric DEFAULT 0, _cost_price numeric DEFAULT 0, _stock numeric DEFAULT 0)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  g public.global_products%ROWTYPE;
  v_new_id uuid;
  v_existing uuid;
  v_sell numeric;
  v_cost numeric;
  v_sku text;
  v_sku_taken boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;

  PERFORM set_config('app.library_import', '1', true);

  SELECT * INTO g FROM public.global_products WHERE id = _global_id AND status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Library item not found or not approved'; END IF;

  IF g.barcode IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.products
      WHERE tenant_id = v_tenant AND barcode = g.barcode LIMIT 1;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  v_sell := CASE WHEN COALESCE(_sell_price, 0) > 0 THEN _sell_price ELSE COALESCE(g.default_sell_price, 0) END;
  v_cost := CASE WHEN COALESCE(_cost_price, 0) > 0 THEN _cost_price ELSE COALESCE(g.default_cost_price, 0) END;
  v_sku := NULLIF(g.item_code, g.barcode);

  IF v_sku IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.products WHERE tenant_id = v_tenant AND sku = v_sku)
      INTO v_sku_taken;
    IF v_sku_taken THEN v_sku := NULL; END IF;
  END IF;

  INSERT INTO public.products
    (tenant_id, name, barcode, sku, category, unit, sell_price, cost_price, stock, is_active)
  VALUES
    (v_tenant, g.name, g.barcode, v_sku, g.category, COALESCE(g.unit, 'pcs'),
     v_sell, v_cost, COALESCE(_stock, 0), true)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END
$$;

CREATE OR REPLACE FUNCTION public.bulk_import_from_global_library()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;

  PERFORM set_config('app.library_import', '1', true);

  WITH src AS (
    SELECT
      g.name, g.barcode, g.category, g.unit,
      g.default_sell_price, g.default_cost_price,
      NULLIF(g.item_code, g.barcode) AS candidate_sku
    FROM public.global_products g
    WHERE g.status = 'approved'
      AND g.barcode IS NOT NULL
      AND public.tenant_category_allowed(v_tenant, g.category)
      AND NOT EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.tenant_id = v_tenant AND p.barcode = g.barcode
      )
  ),
  numbered AS (
    SELECT s.*,
           CASE WHEN s.candidate_sku IS NULL THEN NULL
                ELSE ROW_NUMBER() OVER (PARTITION BY s.candidate_sku ORDER BY s.name)
           END AS rn
    FROM src s
  ),
  inserted AS (
    INSERT INTO public.products
      (tenant_id, name, barcode, sku, category, unit, sell_price, cost_price, stock, is_active)
    SELECT
      v_tenant, n.name, n.barcode,
      CASE
        WHEN n.candidate_sku IS NULL THEN NULL
        WHEN n.rn > 1 THEN NULL
        WHEN EXISTS (
          SELECT 1 FROM public.products p2
          WHERE p2.tenant_id = v_tenant AND p2.sku = n.candidate_sku
        ) THEN NULL
        ELSE n.candidate_sku
      END,
      n.category,
      COALESCE(n.unit, 'pcs'),
      COALESCE(n.default_sell_price, 0),
      COALESCE(n.default_cost_price, 0),
      0,
      true
    FROM numbered n
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;

  RETURN v_count;
END
$$;