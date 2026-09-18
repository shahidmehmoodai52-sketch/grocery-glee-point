-- POS "Charges" (delivery/service fee etc.) failed to save whenever the
-- amount typed exceeded any existing discount. Root cause: sales has no
-- `charge` column, so the client folded the charge into `discount` as a
-- negative number ("Extra charge is applied as a negative discount so the
-- server total matches" -- pos.tsx). complete_sale() explicitly rejects a
-- negative discount ("IF v_discount < 0 THEN RAISE EXCEPTION 'Discount must
-- be non-negative'"), so any charge bigger than the discount made the whole
-- sale fail to save. Even when it happened to stay non-negative, the charge
-- amount was invisible everywhere except the receipt shown at the moment of
-- sale (receipt.tsx already reads a distinct `invoice.charge` field -- that
-- field just never existed in the database, so reprints/reports silently
-- lost it).
--
-- Fix: give `sales` a real `charge` column and have complete_sale/edit_sale
-- add it on top of the total directly, instead of subtracting it from
-- discount.

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS charge numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.complete_sale(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_id UUID;
  v_item JSONB;
  v_subtotal NUMERIC := 0;
  v_cost_total NUMERIC := 0;
  v_tax NUMERIC := COALESCE((payload->>'tax')::NUMERIC, 0);
  v_discount NUMERIC := COALESCE((payload->>'discount')::NUMERIC, 0);
  v_charge NUMERIC := COALESCE((payload->>'charge')::NUMERIC, 0);
  v_paid NUMERIC := COALESCE((payload->>'paid')::NUMERIC, 0);
  v_total NUMERIC;
  v_change NUMERIC;
  v_status TEXT;
  v_customer UUID := NULLIF(payload->>'customer_id','')::UUID;
  v_person UUID := NULLIF(payload->>'expense_person_id','')::UUID;
  v_method TEXT := COALESCE(payload->>'payment_method','cash');
  v_uid UUID := auth.uid();
  v_tenant_id UUID;
  v_invoice_no TEXT;
  v_next_val BIGINT;
  v_shop_code TEXT;
  v_cash_account_id UUID;
  v_prescription_ref TEXT := NULLIF(payload->>'prescription_ref','');
  v_qty NUMERIC;
  v_price NUMERIC;
  v_item_cost NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tax < 0 THEN RAISE EXCEPTION 'Tax must be non-negative'; END IF;
  IF v_discount < 0 THEN RAISE EXCEPTION 'Discount must be non-negative'; END IF;
  IF v_charge < 0 THEN RAISE EXCEPTION 'Charge must be non-negative'; END IF;
  IF v_paid < 0 THEN RAISE EXCEPTION 'Paid amount must be non-negative'; END IF;

  v_tenant_id := (payload->>'_tenant_id')::UUID;

  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id FROM public.tenant_members WHERE user_id = v_uid LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant not found for user'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.user_id = v_uid AND tm.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'User is not a member of this tenant';
  END IF;

  IF v_person IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.expense_persons
       WHERE id = v_person AND tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Staff/owner does not belong to current tenant';
    END IF;
    v_customer := NULL;
  END IF;

  IF v_customer IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customers WHERE id = v_customer AND tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Customer does not belong to current tenant';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    IF NULLIF(v_item->>'product_id','') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.products WHERE id = (v_item->>'product_id')::UUID AND tenant_id = v_tenant_id
      ) THEN
        RAISE EXCEPTION 'Product % does not belong to current tenant', v_item->>'product_id';
      END IF;
    END IF;
    v_qty := (v_item->>'qty')::NUMERIC;
    v_price := (v_item->>'price')::NUMERIC;
    v_item_cost := COALESCE((v_item->>'cost')::NUMERIC, 0);
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    IF v_price IS NULL OR v_price < 0 THEN RAISE EXCEPTION 'Price must be non-negative'; END IF;
    IF v_item_cost < 0 THEN RAISE EXCEPTION 'Cost must be non-negative'; END IF;
    v_subtotal := v_subtotal + (v_qty * v_price);
    v_cost_total := v_cost_total + (v_qty * v_item_cost);
  END LOOP;

  IF v_discount > v_subtotal + v_tax THEN
    RAISE EXCEPTION 'Discount cannot exceed subtotal plus tax';
  END IF;

  v_total := v_subtotal + v_tax - v_discount + v_charge;

  IF v_person IS NOT NULL THEN
    v_paid := v_total;
  END IF;

  v_change := GREATEST(v_paid - v_total, 0);
  IF v_paid >= v_total THEN v_status := 'completed';
  ELSE v_status := 'credit'; END IF;

  SELECT shop_code INTO v_shop_code FROM public.tenants WHERE id = v_tenant_id;

  INSERT INTO public.tenant_sequences (tenant_id, last_sale_value)
  VALUES (v_tenant_id, 1001)
  ON CONFLICT (tenant_id) DO UPDATE
  SET last_sale_value = tenant_sequences.last_sale_value + 1
  RETURNING last_sale_value INTO v_next_val;

  v_invoice_no := 'S-' || COALESCE(v_shop_code, '000') || '-' || v_next_val;

  INSERT INTO public.sales (tenant_id, invoice_no, customer_id, expense_person_id, cashier_id, subtotal, tax, discount, charge, total, cost_total, paid, change_due, payment_method, status, note, created_at, prescription_ref)
  VALUES (
    v_tenant_id, v_invoice_no, v_customer, v_person, v_uid,
    v_subtotal, v_tax, v_discount, v_charge, v_total, v_cost_total, v_paid, v_change,
    v_method, v_status, payload->>'note',
    COALESCE((payload->>'_created_at')::TIMESTAMPTZ, now()),
    v_prescription_ref
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    INSERT INTO public.sale_items (tenant_id, sale_id, product_id, name, qty, price, cost, line_total)
    VALUES (
      v_tenant_id, v_sale_id, NULLIF(v_item->>'product_id','')::UUID,
      v_item->>'name', (v_item->>'qty')::NUMERIC, (v_item->>'price')::NUMERIC,
      COALESCE((v_item->>'cost')::NUMERIC, 0),
      (v_item->>'qty')::NUMERIC * (v_item->>'price')::NUMERIC
    );
    IF NULLIF(v_item->>'product_id','') IS NOT NULL THEN
      UPDATE public.products SET stock = stock - (v_item->>'qty')::NUMERIC, updated_at = now()
      WHERE id = (v_item->>'product_id')::UUID AND tenant_id = v_tenant_id;
    END IF;
  END LOOP;

  IF v_status = 'credit' AND v_customer IS NOT NULL THEN
    UPDATE public.customers SET balance = balance + (v_total - v_paid) WHERE id = v_customer;
  END IF;

  IF v_person IS NOT NULL AND v_total > 0 THEN
    INSERT INTO public.expenses (tenant_id, person_id, sale_id, category, amount, description, method, expense_date, user_id)
    VALUES (
      v_tenant_id, v_person, v_sale_id, 'staff_purchase', v_total,
      'Mart purchase · invoice ' || v_invoice_no, v_method,
      (COALESCE((payload->>'_created_at')::TIMESTAMPTZ, now()))::DATE, v_uid
    );

    SELECT id INTO v_cash_account_id
      FROM public.cash_accounts
      WHERE tenant_id = v_tenant_id AND (LOWER(name) = LOWER(v_method) OR type = 'cash')
      ORDER BY (LOWER(name) = LOWER(v_method)) DESC, sort_order ASC
      LIMIT 1;

    INSERT INTO public.cash_transactions (tenant_id, account_id, direction, amount, occurred_on, category, reference, notes, user_id)
    VALUES (
      v_tenant_id, v_cash_account_id, 'out', v_total,
      (COALESCE((payload->>'_created_at')::TIMESTAMPTZ, now()))::DATE,
      'staff_purchase', 'sale:' || v_sale_id,
      'Staff purchase: ' || v_invoice_no, v_uid
    );
  END IF;

  RETURN v_sale_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.edit_sale(_sale_id uuid, _items jsonb, _paid numeric DEFAULT NULL::numeric, _discount numeric DEFAULT NULL::numeric, _tax numeric DEFAULT NULL::numeric, _charge numeric DEFAULT NULL::numeric)
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
  v_charge NUMERIC;
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
  v_charge   := COALESCE(_charge, v_sale.charge, 0);
  v_tax      := COALESCE(_tax, v_sale.tax, 0);
  IF v_paid < 0 THEN RAISE EXCEPTION 'Paid amount must be non-negative'; END IF;
  IF v_tax < 0 THEN RAISE EXCEPTION 'Tax must be non-negative'; END IF;
  IF v_discount < 0 THEN RAISE EXCEPTION 'Discount must be non-negative'; END IF;
  IF v_charge < 0 THEN RAISE EXCEPTION 'Charge must be non-negative'; END IF;

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

  v_total := v_subtotal + v_tax - v_discount + v_charge;
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

  -- 4) Update sales header (now includes paid / discount / charge / tax)
  UPDATE public.sales SET
    subtotal   = v_subtotal,
    cost_total = v_cost_total,
    discount   = v_discount,
    charge     = v_charge,
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
            'charge', v_charge,
            'tax', v_tax,
            'paid', v_paid,
            'total', v_total,
            'cost_total', v_cost_total,
            'status', v_status
          ));

  RETURN _sale_id;
END; $function$;

-- undo_last_sale() builds its restore payload with an explicit
-- jsonb_build_object() (unlike void_sale(), which snapshots the whole row via
-- to_jsonb() and so picked up the new `charge` column automatically) -- add
-- `charge` here too so "Undo last sale" restores the charge amount into the
-- reopened cart instead of silently dropping it back to 0.
CREATE OR REPLACE FUNCTION public.undo_last_sale(_sale_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'charge', v_sale.charge,
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
$function$;

-- Discovered while testing the fixes above: void_sale() and undo_last_sale()
-- both try to record an audit_logs row with action='VOID_SALE' / 'UNDO_SALE'
-- respectively, but audit_logs_action_check never included either value --
-- only INSERT/UPDATE/DELETE/ADMIN_*/EDIT_SALE. Every real call to either RPC
-- has therefore been failing outright (the whole transaction rolls back on
-- the CHECK violation), meaning "Void sale" and "Undo last sale" have been
-- completely non-functional in production, unrelated to the charge bug --
-- confirmed live with a disposable test sale before this constraint change.
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check
  CHECK (action = ANY (ARRAY[
    'INSERT'::text, 'UPDATE'::text, 'DELETE'::text,
    'ADMIN_SET_STATUS'::text, 'ADMIN_SET_PLAN'::text, 'ADMIN_RESET_PASSWORD'::text, 'ADMIN_ACTION'::text,
    'EDIT_SALE'::text, 'VOID_SALE'::text, 'UNDO_SALE'::text
  ]));
