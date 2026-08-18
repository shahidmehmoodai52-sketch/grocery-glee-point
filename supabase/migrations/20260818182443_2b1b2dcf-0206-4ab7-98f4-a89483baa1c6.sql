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
  v_cash_account_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  v_tenant_id := (payload->>'_tenant_id')::UUID;

  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id FROM public.tenant_members WHERE user_id = v_uid LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant not found for user'; END IF;

  -- A staff/owner purchase belongs to the staff member, never to a customer.
  IF v_person IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.expense_persons
       WHERE id = v_person AND tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Staff/owner does not belong to current tenant';
    END IF;
    v_customer := NULL;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::NUMERIC * (v_item->>'price')::NUMERIC);
    v_cost_total := v_cost_total + ((v_item->>'qty')::NUMERIC * COALESCE((v_item->>'cost')::NUMERIC, 0));
  END LOOP;

  v_total := v_subtotal + v_tax - v_discount;

  -- The shop absorbs a staff purchase as an expense, so the bill is settled in full.
  IF v_person IS NOT NULL THEN
    v_paid := v_total;
  END IF;

  v_change := GREATEST(v_paid - v_total, 0);
  IF v_paid >= v_total THEN v_status := 'completed';
  ELSE v_status := 'credit'; END IF;

  INSERT INTO public.tenant_sequences (tenant_id, last_sale_value)
  VALUES (v_tenant_id, 1001)
  ON CONFLICT (tenant_id) DO UPDATE
  SET last_sale_value = tenant_sequences.last_sale_value + 1
  RETURNING last_sale_value INTO v_next_val;

  v_invoice_no := 'S-' || v_next_val;

  INSERT INTO public.sales (tenant_id, invoice_no, customer_id, expense_person_id, cashier_id, subtotal, tax, discount, total, cost_total, paid, change_due, payment_method, status, note, created_at)
  VALUES (
    v_tenant_id,
    v_invoice_no,
    v_customer,
    v_person,
    v_uid,
    v_subtotal,
    v_tax,
    v_discount,
    v_total,
    v_cost_total,
    v_paid,
    v_change,
    v_method,
    v_status,
    payload->>'note',
    COALESCE((payload->>'_created_at')::TIMESTAMPTZ, now())
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    INSERT INTO public.sale_items (tenant_id, sale_id, product_id, name, qty, price, cost, line_total)
    VALUES (
      v_tenant_id,
      v_sale_id,
      NULLIF(v_item->>'product_id','')::UUID,
      v_item->>'name',
      (v_item->>'qty')::NUMERIC,
      (v_item->>'price')::NUMERIC,
      COALESCE((v_item->>'cost')::NUMERIC, 0),
      (v_item->>'qty')::NUMERIC * (v_item->>'price')::NUMERIC
    );
    IF NULLIF(v_item->>'product_id','') IS NOT NULL THEN
      UPDATE public.products SET stock = stock - (v_item->>'qty')::NUMERIC, updated_at = now()
      WHERE id = (v_item->>'product_id')::UUID;
    END IF;
  END LOOP;

  IF v_status = 'credit' AND v_customer IS NOT NULL THEN
    UPDATE public.customers SET balance = balance + (v_total - v_paid) WHERE id = v_customer;
  END IF;

  -- Staff purchase → shop expense AND cash flow entry
  IF v_person IS NOT NULL AND v_total > 0 THEN
    -- Insert Expense
    INSERT INTO public.expenses (tenant_id, person_id, sale_id, category, amount, description, method, expense_date, user_id)
    VALUES (
      v_tenant_id,
      v_person,
      v_sale_id,
      'staff_purchase',
      v_total,
      'Mart purchase · invoice ' || v_invoice_no,
      v_method,
      (COALESCE((payload->>'_created_at')::TIMESTAMPTZ, now()))::DATE,
      v_uid
    );
    
    -- Find a cash account to attribute the "out" transaction. 
    -- If v_method matches an account name, use it; otherwise use the first cash account.
    SELECT id INTO v_cash_account_id
      FROM public.cash_accounts
      WHERE tenant_id = v_tenant_id AND (LOWER(name) = LOWER(v_method) OR type = 'cash')
      ORDER BY (LOWER(name) = LOWER(v_method)) DESC, sort_order ASC
      LIMIT 1;

    -- Insert Cash Flow Transaction
    INSERT INTO public.cash_transactions (tenant_id, account_id, direction, amount, occurred_on, category, reference, notes, user_id)
    VALUES (
      v_tenant_id, 
      v_cash_account_id,
      'out', 
      v_total, 
      (COALESCE((payload->>'_created_at')::TIMESTAMPTZ, now()))::DATE, 
      'staff_purchase', 
      'sale:' || v_sale_id, 
      'Staff purchase: ' || v_invoice_no, 
      v_uid
    );
  END IF;

  RETURN v_sale_id;
END; $function$;