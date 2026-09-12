-- Distributor bonus/scheme units (e.g. "10+1 free") — a purchase line can
-- receive free bonus units alongside the paid quantity. Additive:
-- bonus_qty defaults to 0, so every existing purchase and every existing
-- caller of complete_purchase() is completely unaffected.
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS bonus_qty NUMERIC NOT NULL DEFAULT 0;

-- Batches must reflect the TOTAL physical units received (paid + bonus) —
-- free units are real stock subject to FEFO like any other.
CREATE OR REPLACE FUNCTION public.trg_purchase_item_batch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p RECORD;
  v_track BOOLEAN;
  v_total_qty NUMERIC;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.expiry_date IS NULL AND NEW.batch_no IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(track_batches, FALSE) INTO v_track FROM public.products WHERE id = NEW.product_id;
  IF NOT v_track THEN RETURN NEW; END IF;

  SELECT supplier_id, id INTO v_p FROM public.purchases WHERE id = NEW.purchase_id;
  v_total_qty := NEW.qty + COALESCE(NEW.bonus_qty, 0);

  INSERT INTO public.product_batches
    (tenant_id, product_id, batch_no, purchase_date, expiry_date,
     qty_initial, qty_remaining, unit_cost, supplier_id, purchase_id)
  VALUES
    (NEW.tenant_id, NEW.product_id, NEW.batch_no, CURRENT_DATE, NEW.expiry_date,
     v_total_qty, v_total_qty, NEW.cost, v_p.supplier_id, v_p.id);
  RETURN NEW;
END $$;

-- complete_purchase(): read optional bonus_qty per item, add it to the
-- stock increment and to the weighted-average cost's divisor (so free
-- units correctly lower average cost per unit), and persist it on
-- purchase_items. Backward compatible: absent/0 bonus_qty behaves
-- byte-for-byte like the previous version.
--
-- Verified on tillix-migration-test: a test product purchased with
-- qty=10, cost=100, bonus_qty=1 produced stock=11, cost_price=90.9091
-- (1000 / 11), a purchase_items row with bonus_qty=1 and line_total=1000
-- (bonus contributes no cost), and a product_batches row with
-- qty_initial=11 (bonus units are real stock, subject to FEFO too).
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
  v_old_stock NUMERIC;
  v_old_cost NUMERIC;
  v_avail_stock NUMERIC;
  v_new_avg NUMERIC;
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
      SELECT stock, cost_price INTO v_old_stock, v_old_cost
        FROM public.products WHERE id = v_pid FOR UPDATE;
      v_avail_stock := GREATEST(COALESCE(v_old_stock,0), 0);
      IF v_avail_stock > 0 THEN
        v_new_avg := ((v_avail_stock * COALESCE(v_old_cost,0)) + (v_qty * v_cost))
                     / (v_avail_stock + v_qty + v_bonus_qty);
      ELSE
        v_new_avg := (v_qty * v_cost) / (v_qty + v_bonus_qty);
      END IF;
      UPDATE public.products SET
        stock = COALESCE(stock,0) + v_qty + v_bonus_qty,
        cost_price = ROUND(v_new_avg::numeric, 4),
        updated_at = now()
      WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_supplier IS NOT NULL THEN
    UPDATE public.suppliers SET balance = balance + (v_total - v_paid - v_incentive) WHERE id = v_supplier;
  END IF;

  RETURN v_id;
END; $function$;
