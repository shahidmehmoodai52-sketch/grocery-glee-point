-- Suspend/expire enforcement fix.
--
-- Root cause: suspend/expire was ONLY ever checked client-side
-- (SuspendedGate, which is skipped entirely while offline), and NEVER
-- server-side -- neither RLS nor complete_sale() checked tenants.status or
-- tenant_subscriptions.expires_at. A suspended or expired tenant's offline
-- desktop app could keep operating indefinitely, and those offline sales
-- would sync successfully once reconnected.
--
-- Fix: current_tenant_id() -- the function 182 RLS policies and most RPCs
-- resolve their tenant through -- now returns NULL for a
-- suspended/archived/expired tenant, so RLS automatically denies access
-- everywhere with zero per-table changes. complete_sale() additionally gets
-- an explicit check, since its offline-replay path accepts a
-- client-supplied _tenant_id and therefore never calls current_tenant_id().
-- my_tenant_status() is switched to a new "raw" (non-gated) lookup so
-- SuspendedGate can still correctly detect and report a suspended/expired
-- tenant instead of that tenant silently disappearing behind the new gate.
--
-- Verified locally (throwaway Postgres 16 instance, not production) against
-- suspended / expired / active tenants and an offline-replay bypass
-- attempt before being applied here.

CREATE OR REPLACE FUNCTION public.current_tenant_id_raw()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tid uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT tenant_id INTO v_tid
    FROM public.tenant_members
    WHERE user_id = v_uid
    ORDER BY created_at DESC
    LIMIT 1;

  RETURN v_tid;
END $function$;

CREATE OR REPLACE FUNCTION public.is_tenant_active(_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_exp timestamptz;
BEGIN
  IF _tenant_id IS NULL THEN RETURN false; END IF;

  SELECT status INTO v_status FROM public.tenants WHERE id = _tenant_id;
  IF v_status IS NULL THEN RETURN false; END IF;
  IF v_status IN ('suspended','archived') THEN RETURN false; END IF;

  SELECT expires_at INTO v_exp
    FROM public.tenant_subscriptions
   WHERE tenant_id = _tenant_id
   ORDER BY started_at DESC
   LIMIT 1;
  IF v_exp IS NOT NULL AND v_exp < now() THEN RETURN false; END IF;

  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tid uuid := public.current_tenant_id_raw();
BEGIN
  IF v_tid IS NULL THEN RETURN NULL; END IF;
  IF NOT public.is_tenant_active(v_tid) THEN RETURN NULL; END IF;
  RETURN v_tid;
END $function$;

CREATE OR REPLACE FUNCTION public.my_tenant_status()
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_status text;
  v_exp timestamptz;
BEGIN
  v_tenant := public.current_tenant_id_raw();
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT status INTO v_status FROM public.tenants WHERE id = v_tenant;
  IF v_status IN ('suspended','archived','pending') THEN
    RETURN v_status;
  END IF;
  SELECT expires_at INTO v_exp
    FROM public.tenant_subscriptions
   WHERE tenant_id = v_tenant
   ORDER BY started_at DESC
   LIMIT 1;
  IF v_exp IS NOT NULL AND v_exp < now() THEN
    RETURN 'expired';
  END IF;
  RETURN v_status;
END $function$;

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

  -- The offline-replay path accepts a client-supplied _tenant_id above,
  -- bypassing current_tenant_id() entirely -- explicit check closes that.
  IF NOT public.is_tenant_active(v_tenant_id) THEN
    RAISE EXCEPTION 'Shop is suspended or subscription has expired';
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
