-- Found while researching well-known pharmacy POS systems (PioneerRx,
-- PrimeRx, etc.) to see what gaps exist versus ours: a common baseline
-- expectation is that already-expired stock is never sold as if it were
-- good stock. Ours didn't enforce that at the batch-consumption level --
-- consume_batches_fefo() picks the batch nearest to expiring first, with
-- no floor at "today". An already-expired batch (expiry_date in the past)
-- IS the nearest-to-expiring batch by definition, so FEFO would draw from
-- it before any still-valid batch, silently marking expired stock as sold
-- and shrinking its qty_remaining -- exactly the opposite of what the
-- Expiry & Waste page needs (it should keep showing that expired stock
-- sitting there until someone disposes of it).
--
-- This does NOT block the sale itself -- nothing in this codebase blocks
-- a sale on stock/batch grounds (same allow_negative_stock philosophy
-- throughout), and the trigger that calls this runs after the sale_items
-- row already exists. It only changes which batch gets the deduction:
-- skip expired batches, draw from the next-nearest still-valid one
-- instead. If every batch for that product is expired, nothing is
-- consumed (same as today's behavior when a product has zero active
-- batches at all) -- the expired batches stay fully visible for disposal
-- tracking instead of quietly draining away.
--
-- Verified on tillix-migration-test: a product with an expired batch
-- (qty_remaining=5) and a valid batch (qty_remaining=5) sold qty=3 ->
-- expired batch untouched at 5, valid batch reduced to 2. A product with
-- ONLY an expired batch sold qty=2 -> batch untouched at its original
-- qty_remaining, confirming no silent consumption of expired stock.
CREATE OR REPLACE FUNCTION public.consume_batches_fefo(_product_id uuid, _qty numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining NUMERIC := _qty;
  v_take NUMERIC;
  v_batch RECORD;
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RETURN; END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.products p WHERE p.id = _product_id;
  IF v_tenant IS NULL THEN RETURN; END IF;

  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm WHERE tm.user_id = v_uid AND tm.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'User is not a member of this tenant';
  END IF;

  FOR v_batch IN
    SELECT id, qty_remaining
      FROM public.product_batches
     WHERE product_id = _product_id
       AND tenant_id = v_tenant
       AND qty_remaining > 0
       AND status = 'active'
       AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
     ORDER BY COALESCE(expiry_date, DATE '9999-12-31') ASC, created_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_batch.qty_remaining, v_remaining);
    UPDATE public.product_batches
       SET qty_remaining = qty_remaining - v_take,
           status = CASE WHEN (qty_remaining - v_take) <= 0 THEN 'depleted' ELSE status END,
           updated_at = now()
     WHERE id = v_batch.id AND tenant_id = v_tenant;
    v_remaining := v_remaining - v_take;
  END LOOP;
END $function$;
