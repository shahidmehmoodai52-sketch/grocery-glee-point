-- Reconciles drift: this function was already applied live in the database
-- (by a concurrent session) but was never committed to a tracked migration.
-- Tracking it here so the migrations folder matches reality, per this repo's
-- convention of reconciling untracked schema drift rather than leaving it
-- silently live-only (see the admin_action_log reconciliation precedent).
--
-- Lets a tenant member correct a product's current stock (e.g. a physical
-- count discrepancy noticed while receiving a purchase) without bypassing
-- the inventory_movements audit trail the way a raw UPDATE would. Mirrors
-- approve_stock_count_session()'s pattern (lock row, update stock, record
-- an audited movement) but scoped to a single product so it can be called
-- inline from the purchase-entry screen instead of requiring a full
-- stock-count session.
CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  _product_id uuid,
  _new_stock numeric,
  _reason text DEFAULT NULL::text,
  _note text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
END $function$;

GRANT EXECUTE ON FUNCTION public.adjust_product_stock(uuid, numeric, text, text) TO authenticated;
