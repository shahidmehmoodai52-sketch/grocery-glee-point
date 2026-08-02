ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.cash_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS purchases_account_id_idx ON public.purchases(account_id);

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
  v_total NUMERIC;
  v_supplier UUID := NULLIF(payload->>'supplier_id','')::UUID;
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_qty NUMERIC;
  v_cost NUMERIC;
  v_pid UUID;
  v_old_stock NUMERIC;
  v_old_cost NUMERIC;
  v_avail_stock NUMERIC;
  v_new_avg NUMERIC;
  v_ok BOOLEAN;
  v_method TEXT := COALESCE(NULLIF(payload->>'payment_method',''), 'cash');
  v_account UUID := NULLIF(payload->>'account_id','')::UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF v_tax < 0 OR v_paid < 0 THEN RAISE EXCEPTION 'Tax and paid must be non-negative'; END IF;

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
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    IF v_cost IS NULL OR v_cost < 0 THEN RAISE EXCEPTION 'Cost must be non-negative'; END IF;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    IF v_pid IS NOT NULL THEN
      v_ok := NULL;
      SELECT true INTO v_ok FROM public.products WHERE id = v_pid AND tenant_id = v_tenant;
      IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Product % does not belong to current tenant', v_pid; END IF;
    END IF;
    v_subtotal := v_subtotal + (v_qty * v_cost);
  END LOOP;
  v_total := v_subtotal + v_tax;

  INSERT INTO public.purchases (tenant_id, supplier_id, user_id, subtotal, tax, total, paid, note, payment_method, account_id, created_at)
  VALUES (v_tenant, v_supplier, v_uid, v_subtotal, v_tax, v_total, v_paid, payload->>'note', v_method, v_account, COALESCE(NULLIF(payload->>'created_at','')::timestamptz, now()))
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_cost := (v_item->>'cost')::NUMERIC;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;

    INSERT INTO public.purchase_items (tenant_id, purchase_id, product_id, name, qty, cost, line_total)
    VALUES (v_tenant, v_id, v_pid, v_item->>'name', v_qty, v_cost, v_qty * v_cost);

    IF v_pid IS NOT NULL THEN
      SELECT stock, cost_price INTO v_old_stock, v_old_cost
        FROM public.products WHERE id = v_pid FOR UPDATE;
      v_avail_stock := GREATEST(COALESCE(v_old_stock,0), 0);
      IF v_avail_stock > 0 THEN
        v_new_avg := ((v_avail_stock * COALESCE(v_old_cost,0)) + (v_qty * v_cost))
                     / (v_avail_stock + v_qty);
      ELSE
        v_new_avg := v_cost;
      END IF;
      UPDATE public.products SET
        stock = COALESCE(stock,0) + v_qty,
        cost_price = ROUND(v_new_avg::numeric, 4),
        updated_at = now()
      WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_total > v_paid AND v_supplier IS NOT NULL THEN
    UPDATE public.suppliers SET balance = balance + (v_total - v_paid) WHERE id = v_supplier;
  END IF;

  RETURN v_id;
END; $function$;