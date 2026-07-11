
-- 1) Re-enable auto submit-to-library from shops (pending developer approval).
--    Only when barcode is present and not already in library. Runs as definer
--    so the tenant user does not need INSERT rights on global_products.
CREATE OR REPLACE FUNCTION public.auto_contribute_global_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bc text := NULLIF(trim(NEW.barcode), '');
  v_name text := NULLIF(trim(NEW.name), '');
BEGIN
  IF v_bc IS NULL OR v_name IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.global_products
    (name, barcode, category, unit, status, contributed_by_tenant, contributed_by_user)
  VALUES
    (v_name, v_bc, NEW.category, COALESCE(NEW.unit, 'pcs'),
     'pending', NEW.tenant_id, auth.uid())
  ON CONFLICT (barcode) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_contribute_global_product ON public.products;
CREATE TRIGGER trg_auto_contribute_global_product
AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.auto_contribute_global_product();

-- 2) One-click bulk import: pull every approved library item into the caller's
--    shop that isn't already there. Sale/cost/stock start at 0 so the shop can
--    edit them before billing. Returns the number of items added.
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
      0, 0, 0, true
    FROM public.global_products g
    WHERE g.status = 'approved'
      AND g.barcode IS NOT NULL
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

GRANT EXECUTE ON FUNCTION public.bulk_import_from_global_library() TO authenticated;
