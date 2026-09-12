-- Security fix: complete_sale had no input validation at all, unlike its two
-- sibling functions (complete_purchase, complete_sale_return), which already
-- reject negative/invalid qty, price, tax, discount. Without these guards:
--   - a negative qty INCREASES stock (stock = stock - qty with qty < 0) while
--     the sale is still recorded as 'completed' if paid >= total (a negative
--     total makes that trivially true) — a free stock top-up disguised as a
--     completed sale.
--   - a negative price, or a discount larger than subtotal+tax, drives total
--     to zero or negative while stock still decrements normally — giving away
--     inventory for free with no exception raised.
--   - a negative per-item cost lets a cashier distort cost_total, which feeds
--     Reports/Dashboard profit figures.
-- This migration only adds validation (RAISE EXCEPTION guards matching the
-- exact style already used in complete_purchase/complete_sale_return) —
-- no change to the happy-path math, so every legitimate sale is unaffected.
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

  v_total := v_subtotal + v_tax - v_discount;

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

  INSERT INTO public.sales (tenant_id, invoice_no, customer_id, expense_person_id, cashier_id, subtotal, tax, discount, total, cost_total, paid, change_due, payment_method, status, note, created_at, prescription_ref)
  VALUES (
    v_tenant_id, v_invoice_no, v_customer, v_person, v_uid,
    v_subtotal, v_tax, v_discount, v_total, v_cost_total, v_paid, v_change,
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
