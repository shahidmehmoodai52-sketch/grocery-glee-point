-- Sale returns could only be created, never corrected: a wrong qty/price,
-- a duplicate (e.g. SR-023-1077 / SR-023-1078, same item 13s apart) or a
-- return on the wrong customer had no way out. A raw DELETE/UPDATE from the
-- client would leave stock, the customer's balance, the staff expense and
-- the staff cash entry that complete_sale_return() changed out of step, so
-- both operations go through these RPCs, which undo exactly those effects.
--
-- Admin only, matching the sale_returns UPDATE/DELETE RLS policies.

-- Undo everything complete_sale_return() did for one return, except the
-- sale_returns row itself. Stock goes back down (with a matching movement
-- row so the stock history still adds up), batches are drawn down again,
-- the customer's credit is restored, the staff expense regrows and the staff
-- cash-in is removed. Line items are deleted.
CREATE OR REPLACE FUNCTION public._reverse_sale_return_effects(_r public.sale_returns, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_it RECORD;
  v_track boolean;
BEGIN
  FOR v_it IN SELECT * FROM public.sale_return_items WHERE return_id = _r.id LOOP
    IF v_it.product_id IS NOT NULL AND v_it.qty > 0 THEN
      PERFORM public.record_inventory_movement(
        _r.tenant_id, v_it.product_id, 'sale_return', 'sale_return',
        _r.id, _r.return_no, -v_it.qty, v_it.cost,
        auth.uid(), _r.customer_id, NULL, _reason, NULL);
      UPDATE public.products SET stock = COALESCE(stock, 0) - v_it.qty, updated_at = now()
       WHERE id = v_it.product_id;
      SELECT COALESCE(track_batches, false) INTO v_track FROM public.products WHERE id = v_it.product_id;
      IF v_track THEN
        PERFORM public.consume_batches_fefo(v_it.product_id, v_it.qty);
      END IF;
    END IF;
  END LOOP;

  IF _r.party_type = 'staff' THEN
    UPDATE public.expenses SET amount = amount + _r.total, updated_at = now()
     WHERE sale_id = _r.sale_id AND person_id = _r.expense_person_id AND tenant_id = _r.tenant_id;
    DELETE FROM public.cash_transactions
     WHERE tenant_id = _r.tenant_id AND reference = 'sale_return:' || _r.id;
  ELSIF _r.customer_id IS NOT NULL AND _r.total > _r.refund_amount THEN
    UPDATE public.customers SET balance = balance + (_r.total - _r.refund_amount)
     WHERE id = _r.customer_id;
  END IF;

  DELETE FROM public.sale_return_items WHERE return_id = _r.id;
END $function$;

REVOKE ALL ON FUNCTION public._reverse_sale_return_effects(public.sale_returns, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_sale_return(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_r public.sale_returns%ROWTYPE;
  v_old jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'Only an admin can delete a sale return'; END IF;

  SELECT * INTO v_r FROM public.sale_returns WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'Sale return not found'; END IF;

  v_old := jsonb_build_object(
    'return', to_jsonb(v_r),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM public.sale_return_items i WHERE i.return_id = _id), '[]'::jsonb));

  PERFORM public._reverse_sale_return_effects(v_r, 'Sale return deleted');
  DELETE FROM public.sale_returns WHERE id = _id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, old_data, new_data)
  VALUES (v_tenant, v_uid, 'DELETE', 'sale_returns', _id, v_old, NULL);
END $function$;

-- payload: { items: [{product_id, name, qty, price}], tax, refund_amount,
--            refund_method, note, customer_id }
-- The invoice link and party type (customer / staff) stay as they were;
-- return_no and the original date are kept.
CREATE OR REPLACE FUNCTION public.edit_sale_return(_id uuid, payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_r public.sale_returns%ROWTYPE;
  v_old jsonb;
  v_item jsonb;
  v_subtotal numeric := 0;
  v_tax numeric := COALESCE((payload->>'tax')::numeric, 0);
  v_refund numeric := COALESCE((payload->>'refund_amount')::numeric, 0);
  v_method text := COALESCE(NULLIF(payload->>'refund_method', ''), 'cash');
  v_customer uuid := NULLIF(payload->>'customer_id', '')::uuid;
  v_total numeric;
  v_pid uuid;
  v_qty numeric;
  v_price numeric;
  v_cost numeric;
  v_name text;
  v_ok boolean;
  v_cash_account_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'Only an admin can edit a sale return'; END IF;

  SELECT * INTO v_r FROM public.sale_returns WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'Sale return not found'; END IF;

  IF jsonb_typeof(payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'items') = 0 THEN
    RAISE EXCEPTION 'A return needs at least one item';
  END IF;

  IF v_r.party_type = 'staff' THEN
    v_customer := NULL;
    v_refund := 0;
    v_method := 'staff';
  ELSIF v_customer IS NOT NULL THEN
    SELECT true INTO v_ok FROM public.customers WHERE id = v_customer AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok, false) THEN RAISE EXCEPTION 'Customer does not belong to current tenant'; END IF;
  END IF;
  IF v_tax < 0 OR v_refund < 0 THEN RAISE EXCEPTION 'Tax/refund must be non-negative'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    v_price := COALESCE((v_item->>'price')::numeric, 0);
    IF v_price < 0 THEN RAISE EXCEPTION 'Price must be non-negative'; END IF;
    v_pid := NULLIF(v_item->>'product_id', '')::uuid;
    IF v_pid IS NOT NULL THEN
      v_ok := NULL;
      SELECT true INTO v_ok FROM public.products WHERE id = v_pid AND tenant_id = v_tenant;
      IF NOT COALESCE(v_ok, false) THEN RAISE EXCEPTION 'Product % does not belong to current tenant', v_pid; END IF;
    END IF;
    v_subtotal := v_subtotal + v_qty * v_price;
  END LOOP;
  v_total := v_subtotal + v_tax;
  IF v_refund > v_total THEN RAISE EXCEPTION 'Refund exceeds return total'; END IF;

  v_old := jsonb_build_object(
    'return', to_jsonb(v_r),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM public.sale_return_items i WHERE i.return_id = _id), '[]'::jsonb));

  PERFORM public._reverse_sale_return_effects(v_r, 'Sale return edited');

  -- Header first: the item triggers read customer_id from it.
  UPDATE public.sale_returns
     SET customer_id = v_customer, subtotal = v_subtotal, tax = v_tax, total = v_total,
         refund_amount = v_refund, refund_method = v_method, note = payload->>'note'
   WHERE id = _id;

  -- Re-apply, same as complete_sale_return().
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::numeric;
    v_pid := NULLIF(v_item->>'product_id', '')::uuid;
    v_price := COALESCE((v_item->>'price')::numeric, 0);
    v_cost := 0;
    v_name := COALESCE(NULLIF(v_item->>'name', ''), 'Item');
    IF v_pid IS NOT NULL THEN
      SELECT name, cost_price INTO v_name, v_cost FROM public.products WHERE id = v_pid;
    END IF;
    INSERT INTO public.sale_return_items (tenant_id, return_id, product_id, name, qty, price, cost, line_total)
    VALUES (v_tenant, _id, v_pid, v_name, v_qty, v_price, COALESCE(v_cost, 0), v_qty * v_price);
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET stock = stock + v_qty, updated_at = now() WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_r.party_type = 'staff' THEN
    UPDATE public.expenses SET amount = GREATEST(amount - v_total, 0), updated_at = now()
     WHERE sale_id = v_r.sale_id AND person_id = v_r.expense_person_id AND tenant_id = v_tenant;
    SELECT account_id INTO v_cash_account_id FROM public.cash_transactions
     WHERE tenant_id = v_tenant AND reference = 'sale:' || v_r.sale_id
     ORDER BY created_at ASC LIMIT 1;
    IF v_cash_account_id IS NOT NULL AND v_total > 0 THEN
      INSERT INTO public.cash_transactions (tenant_id, account_id, direction, amount, occurred_on, category, reference, notes, user_id)
      VALUES (v_tenant, v_cash_account_id, 'in', v_total, v_r.created_at::date, 'staff_purchase_return',
              'sale_return:' || _id, 'Staff purchase return', v_uid);
    END IF;
  ELSIF v_customer IS NOT NULL AND v_total > v_refund THEN
    UPDATE public.customers SET balance = balance - (v_total - v_refund) WHERE id = v_customer;
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, old_data, new_data)
  VALUES (v_tenant, v_uid, 'UPDATE', 'sale_returns', _id, v_old,
          jsonb_build_object('payload', payload, 'total', v_total));

  RETURN _id;
END $function$;

REVOKE ALL ON FUNCTION public.delete_sale_return(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_sale_return(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_sale_return(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_sale_return(uuid, jsonb) TO authenticated;
