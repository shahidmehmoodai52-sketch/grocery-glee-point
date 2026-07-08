
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS undo_window_minutes INTEGER NOT NULL DEFAULT 5;

CREATE OR REPLACE FUNCTION public.undo_last_sale(_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_sale public.sales%ROWTYPE;
  v_window int;
  v_age_seconds numeric;
  v_has_return boolean;
  v_payload jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;

  SELECT * INTO v_sale
    FROM public.sales
    WHERE id = _sale_id AND tenant_id = v_tenant
    FOR UPDATE;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;

  IF v_sale.cashier_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the original cashier can undo this sale';
  END IF;

  SELECT COALESCE(undo_window_minutes, 5) INTO v_window
    FROM public.store_settings
    WHERE tenant_id = v_tenant
    LIMIT 1;
  IF v_window IS NULL THEN v_window := 5; END IF;

  v_age_seconds := EXTRACT(EPOCH FROM (now() - v_sale.created_at));
  IF v_age_seconds > v_window * 60 THEN
    RAISE EXCEPTION 'Undo window (% minutes) has expired for this sale', v_window;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.sale_returns WHERE sale_id = _sale_id
  ) INTO v_has_return;
  IF v_has_return THEN
    RAISE EXCEPTION 'This sale already has a return and cannot be undone';
  END IF;

  IF v_sale.status NOT IN ('completed','credit') THEN
    RAISE EXCEPTION 'This sale is finalized and cannot be undone';
  END IF;

  SELECT jsonb_build_object(
    'sale_id', v_sale.id,
    'invoice_no', v_sale.invoice_no,
    'customer_id', v_sale.customer_id,
    'expense_person_id', v_sale.expense_person_id,
    'payment_method', v_sale.payment_method,
    'discount', v_sale.discount,
    'tax', v_sale.tax,
    'paid', v_sale.paid,
    'total', v_sale.total,
    'note', v_sale.note,
    'cashier_id', v_sale.cashier_id,
    'created_at', v_sale.created_at,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id,
        'name', si.name,
        'qty', si.qty,
        'price', si.price,
        'cost', si.cost
      ) ORDER BY si.id)
      FROM public.sale_items si
      WHERE si.sale_id = _sale_id
    ), '[]'::jsonb)
  ) INTO v_payload;

  -- Restore stock for every line with a product reference
  UPDATE public.products p
     SET stock = COALESCE(p.stock, 0) + si.qty,
         updated_at = now()
    FROM public.sale_items si
   WHERE si.sale_id = _sale_id
     AND si.product_id = p.id;

  -- Reverse customer credit exposure
  IF v_sale.status = 'credit'
     AND v_sale.customer_id IS NOT NULL
     AND (v_sale.total - v_sale.paid) > 0 THEN
    UPDATE public.customers
       SET balance = balance - (v_sale.total - v_sale.paid)
     WHERE id = v_sale.customer_id;
  END IF;

  -- Reverse the auto-created staff/owner expense
  IF v_sale.expense_person_id IS NOT NULL THEN
    DELETE FROM public.expenses WHERE sale_id = _sale_id;
  END IF;

  DELETE FROM public.sale_items WHERE sale_id = _sale_id;
  DELETE FROM public.sales WHERE id = _sale_id;

  -- Explicit audit entry for the undo action
  INSERT INTO public.audit_logs
    (tenant_id, user_id, action, table_name, record_id, old_data, new_data)
  VALUES
    (v_tenant, v_uid, 'UNDO_SALE', 'sales', _sale_id, v_payload, NULL);

  RETURN v_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.undo_last_sale(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_last_sale(uuid) TO authenticated;
