-- complete_purchase() was updating a product's cost_price with a weighted
-- average against whatever stock was already on hand, rather than simply
-- taking the rate just entered on this purchase. Real report: a shop typed
-- a new, higher rate for a product while buying a small quantity against a
-- much larger existing stock -- cost_price barely moved, reading as "the
-- new rate doesn't save, it keeps the old one." Confirmed against live
-- data: e.g. "30 Biscuts Chocolat Etc" purchased today at 26.8983 with 291
-- units already in stock landed at cost_price 26.2601, not 26.8983.
--
-- Per user decision: cost_price should simply become whatever rate was
-- just entered -- the simpler, more common convention for a small shop,
-- and what "change the rate" already reads as to someone using this
-- screen. No weighted-average math anywhere else in the app depends on
-- this function (single call site: purchases.tsx's non-edit "New purchase"
-- flow).
--
-- Verified directly against production (Supabase branching isn't
-- available on this plan): deployed via CREATE OR REPLACE, then ran a
-- real complete_purchase() call under a simulated auth session against a
-- disposable test product (stock 100 @ cost_price 50) purchasing qty 10 @
-- cost 80 -- resulting stock was 110 (correct) and cost_price was exactly
-- 80.0000 (not a blended ~52.7), matching the fix exactly. Test purchase,
-- its items, the inventory_movements row from the trigger, and the test
-- product were all deleted afterward.

CREATE OR REPLACE FUNCTION public.complete_purchase(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_item JSONB;
  v_subtotal NUMERIC := 0;
  v_tax NUMERIC := COALESCE((payload->>'tax')::NUMERIC, 0);
  v_paid NUMERIC := COALESCE((payload->>'paid')::NUMERIC, 0);
  v_incentive NUMERIC := COALESCE((payload->>'incentive_amount')::NUMERIC, 0);
  v_total NUMERIC;
  v_supplier UUID := NULLIF(payload->>'supplier_id','')::UUID;
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_qty NUMERIC;
  v_bonus_qty NUMERIC;
  v_cost NUMERIC;
  v_pid UUID;
  v_ok BOOLEAN;
  v_method TEXT := COALESCE(NULLIF(payload->>'payment_method',''), 'cash');
  v_account UUID := NULLIF(payload->>'account_id','')::UUID;
  v_batch_no TEXT;
  v_expiry_date DATE;
  v_mfg_date DATE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF v_tax < 0 OR v_paid < 0 THEN RAISE EXCEPTION 'Tax and paid must be non-negative'; END IF;
  IF v_incentive < 0 THEN RAISE EXCEPTION 'Incentive must be non-negative'; END IF;

  IF v_supplier IS NOT NULL THEN
    SELECT true INTO v_ok FROM public.suppliers WHERE id = v_supplier AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Supplier does not belong to current tenant'; END IF;
  END IF;

  IF v_account IS NOT NULL THEN
    v_ok := NULL;
    SELECT true INTO v_ok FROM public.cash_accounts WHERE id = v_account AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Payment account does not belong to current tenant'; END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_cost := (v_item->>'cost')::NUMERIC;
    v_bonus_qty := COALESCE((v_item->>'bonus_qty')::NUMERIC, 0);
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    IF v_cost IS NULL OR v_cost < 0 THEN RAISE EXCEPTION 'Cost must be non-negative'; END IF;
    IF v_bonus_qty < 0 THEN RAISE EXCEPTION 'Bonus quantity must be non-negative'; END IF;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    IF v_pid IS NOT NULL THEN
      v_ok := NULL;
      SELECT true INTO v_ok FROM public.products WHERE id = v_pid AND tenant_id = v_tenant;
      IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Product % does not belong to current tenant', v_pid; END IF;
    END IF;
    v_subtotal := v_subtotal + (v_qty * v_cost);
  END LOOP;
  v_total := v_subtotal + v_tax;

  INSERT INTO public.purchases (tenant_id, supplier_id, user_id, subtotal, tax, total, paid, incentive_amount, note, payment_method, account_id)
  VALUES (v_tenant, v_supplier, v_uid, v_subtotal, v_tax, v_total, v_paid, v_incentive, payload->>'note', v_method, v_account)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_cost := (v_item->>'cost')::NUMERIC;
    v_bonus_qty := COALESCE((v_item->>'bonus_qty')::NUMERIC, 0);
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    v_batch_no := NULLIF(v_item->>'batch_no','');
    v_expiry_date := NULLIF(v_item->>'expiry_date','')::DATE;
    v_mfg_date := NULLIF(v_item->>'mfg_date','')::DATE;

    INSERT INTO public.purchase_items (tenant_id, purchase_id, product_id, name, qty, cost, line_total, batch_no, expiry_date, mfg_date, bonus_qty)
    VALUES (v_tenant, v_id, v_pid, v_item->>'name', v_qty, v_cost, v_qty * v_cost, v_batch_no, v_expiry_date, v_mfg_date, v_bonus_qty);

    IF v_pid IS NOT NULL THEN
      -- cost_price is simply the rate just entered on this purchase, not a
      -- weighted average with existing stock -- a shop owner correcting a
      -- product's rate expects it to take immediately, not get diluted by
      -- however much stock is already on hand (a large existing stock could
      -- leave cost_price barely moved even after an explicit rate change).
      UPDATE public.products SET
        stock = COALESCE(stock,0) + v_qty + v_bonus_qty,
        cost_price = v_cost,
        updated_at = now()
      WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_supplier IS NOT NULL THEN
    UPDATE public.suppliers SET balance = balance + (v_total - v_paid - v_incentive) WHERE id = v_supplier;
  END IF;

  RETURN v_id;
END; $function$;
