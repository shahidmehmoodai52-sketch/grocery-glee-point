CREATE OR REPLACE FUNCTION public.edit_sale(
  _sale_id uuid,
  _items jsonb,
  _paid numeric DEFAULT NULL,
  _discount numeric DEFAULT NULL,
  _tax numeric DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_sale public.sales%ROWTYPE;
  v_old_payload JSONB;
  v_item JSONB;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_cost NUMERIC;
  v_pid UUID;
  v_name TEXT;
  v_subtotal NUMERIC := 0;
  v_cost_total NUMERIC := 0;
  v_total NUMERIC;
  v_status TEXT;
  v_change NUMERIC;
  v_override_price NUMERIC;
  v_paid NUMERIC;
  v_discount NUMERIC;
  v_tax NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF NOT public.has_role(v_uid,'admin') THEN RAISE EXCEPTION 'Only an admin can edit a sale'; END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id=_sale_id AND tenant_id=v_tenant FOR UPDATE;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.status = 'voided' THEN RAISE EXCEPTION 'Cannot edit a voided sale'; END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;

  -- New header figures: use the supplied values, else keep the originals.
  v_paid     := COALESCE(_paid, v_sale.paid, 0);
  v_discount := COALESCE(_discount, v_sale.discount, 0);
  v_tax      := COALESCE(_tax, v_sale.tax, 0);
  IF v_paid < 0 THEN RAISE EXCEPTION 'Paid amount must be non-negative'; END IF;
  IF v_tax < 0 THEN RAISE EXCEPTION 'Tax must be non-negative'; END IF;

  SELECT jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(si)) FROM public.sale_items si WHERE si.sale_id = _sale_id), '[]'::jsonb)
  ) INTO v_old_payload;

  -- 1) Reverse old side effects
  UPDATE public.products p SET stock = COALESCE(p.stock,0) + si.qty, updated_at=now()
    FROM public.sale_items si
   WHERE si.sale_id = _sale_id AND si.product_id = p.id;

  IF v_sale.status='credit' AND v_sale.customer_id IS NOT NULL AND (v_sale.total - v_sale.paid) > 0 THEN
    UPDATE public.customers SET balance = balance - (v_sale.total - v_sale.paid) WHERE id = v_sale.customer_id;
  END IF;

  IF v_sale.expense_person_id IS NOT NULL THEN
    DELETE FROM public.expenses WHERE sale_id = _sale_id;
  END IF;

  DELETE FROM public.sale_items WHERE sale_id = _sale_id;

  -- 2) Recompute from new items
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    v_override_price := NULLIF(v_item->>'price','')::NUMERIC;
    IF v_pid IS NOT NULL THEN
      SELECT sell_price, cost_price, name INTO v_price, v_cost, v_name
        FROM public.products WHERE id = v_pid AND tenant_id = v_tenant;
      IF v_price IS NULL THEN RAISE EXCEPTION 'Unknown product % (or wrong tenant)', v_pid; END IF;
      IF v_override_price IS NOT NULL AND v_override_price >= 0 THEN
        v_price := v_override_price;
      END IF;
    ELSE
      v_price := COALESCE(v_override_price, 0);
      v_cost  := COALESCE((v_item->>'cost')::NUMERIC, 0);
      v_name  := v_item->>'name';
      IF v_price < 0 OR v_cost < 0 THEN RAISE EXCEPTION 'Price/cost must be non-negative'; END IF;
    END IF;
    v_subtotal := v_subtotal + (v_qty * v_price);
    v_cost_total := v_cost_total + (v_qty * v_cost);
  END LOOP;

  IF v_discount > v_subtotal THEN RAISE EXCEPTION 'Discount exceeds new subtotal'; END IF;

  v_total := v_subtotal + v_tax - v_discount;
  v_change := GREATEST(v_paid - v_total, 0);
  IF v_paid >= v_total THEN v_status := 'completed'; ELSE v_status := 'credit'; END IF;

  -- 3) Re-insert items, decrement stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    v_override_price := NULLIF(v_item->>'price','')::NUMERIC;
    IF v_pid IS NOT NULL THEN
      SELECT sell_price, cost_price, name INTO v_price, v_cost, v_name
        FROM public.products WHERE id = v_pid;
      IF v_override_price IS NOT NULL AND v_override_price >= 0 THEN
        v_price := v_override_price;
      END IF;
    ELSE
      v_price := COALESCE(v_override_price, 0);
      v_cost  := COALESCE((v_item->>'cost')::NUMERIC, 0);
      v_name  := v_item->>'name';
    END IF;
    INSERT INTO public.sale_items (tenant_id, sale_id, product_id, name, qty, price, cost, line_total)
    VALUES (v_tenant, _sale_id, v_pid, v_name, v_qty, v_price, v_cost, v_qty * v_price);
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET stock = stock - v_qty, updated_at = now() WHERE id = v_pid;
    END IF;
  END LOOP;

  -- 4) Update sales header (now includes paid / discount / tax)
  UPDATE public.sales SET
    subtotal   = v_subtotal,
    cost_total = v_cost_total,
    discount   = v_discount,
    tax        = v_tax,
    paid       = v_paid,
    total      = v_total,
    change_due = v_change,
    status     = v_status,
    updated_at = now()
  WHERE id = _sale_id;

  -- 5) Re-apply credit balance
  IF v_status='credit' AND v_sale.customer_id IS NOT NULL AND (v_total - v_paid) > 0 THEN
    UPDATE public.customers SET balance = balance + (v_total - v_paid) WHERE id = v_sale.customer_id;
  END IF;

  -- 6) Re-apply staff expense
  IF v_sale.expense_person_id IS NOT NULL THEN
    INSERT INTO public.expenses (tenant_id, person_id, sale_id, category, amount, description, method, expense_date, user_id)
    VALUES (v_tenant, v_sale.expense_person_id, _sale_id, 'staff_purchase', v_total,
            'Mart purchase · invoice ' || COALESCE(v_sale.invoice_no, _sale_id::text),
            v_sale.payment_method, CURRENT_DATE, v_uid);
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, old_data, new_data)
  VALUES (v_tenant, v_uid, 'EDIT_SALE', 'sales', _sale_id, v_old_payload,
          jsonb_build_object(
            'items', _items,
            'subtotal', v_subtotal,
            'discount', v_discount,
            'tax', v_tax,
            'paid', v_paid,
            'total', v_total,
            'cost_total', v_cost_total,
            'status', v_status
          ));

  RETURN _sale_id;
END; $function$;
