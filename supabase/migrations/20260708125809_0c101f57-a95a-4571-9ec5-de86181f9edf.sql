
-- Remove the ambiguous products UPDATE trigger; manual adjustments go through a dedicated RPC.
DROP TRIGGER IF EXISTS trg_products_stock_adjustment ON public.products;
DROP FUNCTION IF EXISTS public.trg_product_stock_adjustment();

-- Rewrite record_inventory_movement to accept explicit stock_before/after
CREATE OR REPLACE FUNCTION public.record_inventory_movement(
  _tenant_id UUID,
  _product_id UUID,
  _movement_type public.inventory_movement_type,
  _reference_type public.inventory_reference_type,
  _reference_id UUID,
  _reference_no TEXT,
  _qty_change NUMERIC,
  _unit_cost NUMERIC,
  _user_id UUID,
  _customer_id UUID,
  _supplier_id UUID,
  _reason TEXT,
  _note TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_current NUMERIC;
  v_before NUMERIC;
  v_after NUMERIC;
BEGIN
  IF _product_id IS NULL OR _tenant_id IS NULL OR _qty_change IS NULL THEN
    RETURN NULL;
  END IF;

  -- Item-level triggers fire AFTER item INSERT but BEFORE the RPC updates products.stock,
  -- so the "current" read reflects the pre-change stock (= stock_before).
  SELECT COALESCE(stock, 0) INTO v_current FROM public.products WHERE id = _product_id;
  v_before := COALESCE(v_current, 0);
  v_after  := v_before + COALESCE(_qty_change, 0);

  INSERT INTO public.inventory_movements (
    tenant_id, product_id, movement_type, reference_type, reference_id, reference_no,
    qty_change, stock_before, stock_after, unit_cost, total_cost,
    user_id, customer_id, supplier_id, reason, note
  ) VALUES (
    _tenant_id, _product_id, _movement_type, _reference_type, _reference_id, _reference_no,
    _qty_change, v_before, v_after,
    _unit_cost,
    CASE WHEN _unit_cost IS NULL THEN NULL ELSE ROUND((_unit_cost * ABS(_qty_change))::numeric, 4) END,
    _user_id, _customer_id, _supplier_id, _reason, _note
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- Dedicated RPC for manual stock adjustments
CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  _product_id UUID,
  _new_stock NUMERIC,
  _reason TEXT DEFAULT NULL,
  _note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_before NUMERIC;
  v_delta NUMERIC;
  v_cost NUMERIC;
  v_mov UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF _new_stock IS NULL THEN RAISE EXCEPTION 'New stock is required'; END IF;

  SELECT COALESCE(stock,0), COALESCE(cost_price,0) INTO v_before, v_cost
    FROM public.products
    WHERE id = _product_id AND tenant_id = v_tenant
    FOR UPDATE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  v_delta := _new_stock - v_before;
  IF v_delta = 0 THEN RETURN NULL; END IF;

  UPDATE public.products SET stock = _new_stock, updated_at = now() WHERE id = _product_id;

  INSERT INTO public.inventory_movements (
    tenant_id, product_id, movement_type, reference_type, reference_id, reference_no,
    qty_change, stock_before, stock_after, unit_cost, total_cost,
    user_id, reason, note
  ) VALUES (
    v_tenant, _product_id, 'adjustment', 'adjustment',
    _product_id, NULL,
    v_delta, v_before, _new_stock, v_cost,
    ROUND((v_cost * ABS(v_delta))::numeric, 4),
    v_uid, _reason, _note
  ) RETURNING id INTO v_mov;

  RETURN v_mov;
END $$;

GRANT EXECUTE ON FUNCTION public.adjust_product_stock(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
