
-- ============================================================
-- Phase 3: Tenant-aware WRITES (additive; no RLS/UI changes)
-- ============================================================

-- 1) Default tenant_id = current_tenant_id() on all 17 operational tables
ALTER TABLE public.customers          ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.suppliers          ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.expense_persons    ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.expenses           ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.products           ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.product_barcodes   ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.sales              ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.sale_items         ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.sale_returns       ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.sale_return_items  ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.purchases          ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.purchase_items     ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.purchase_returns   ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.purchase_return_items ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.party_payments     ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.import_batches     ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.store_settings     ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();

-- 2) Safety trigger: if NEW.tenant_id is NULL at INSERT time, fill from current_tenant_id()
CREATE OR REPLACE FUNCTION public.fill_tenant_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.current_tenant_id();
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'customers','suppliers','expense_persons','expenses',
    'products','product_barcodes',
    'sales','sale_items','sale_returns','sale_return_items',
    'purchases','purchase_items','purchase_returns','purchase_return_items',
    'party_payments','import_batches','store_settings'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_tenant_id ON public.%I;', t);
    EXECUTE format('CREATE TRIGGER trg_fill_tenant_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fill_tenant_id();', t);
  END LOOP;
END $$;

-- 3) RPC: complete_sale — tenant-aware + cross-tenant validation
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
  v_tenant UUID := public.current_tenant_id();
  v_pid UUID;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_cost NUMERIC;
  v_name TEXT;
  v_inv TEXT;
  v_ok BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF v_tax < 0 OR v_discount < 0 OR v_paid < 0 THEN
    RAISE EXCEPTION 'Tax, discount, and paid must be non-negative';
  END IF;

  IF v_customer IS NOT NULL THEN
    SELECT true INTO v_ok FROM public.customers WHERE id = v_customer AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Customer does not belong to current tenant'; END IF;
  END IF;
  IF v_person IS NOT NULL THEN
    v_ok := NULL;
    SELECT true INTO v_ok FROM public.expense_persons WHERE id = v_person AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Expense person does not belong to current tenant'; END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    IF v_pid IS NOT NULL THEN
      SELECT sell_price, cost_price, name INTO v_price, v_cost, v_name
        FROM public.products WHERE id = v_pid AND is_active = true AND tenant_id = v_tenant;
      IF v_price IS NULL THEN RAISE EXCEPTION 'Unknown or inactive product % (or wrong tenant)', v_pid; END IF;
    ELSE
      v_price := COALESCE((v_item->>'price')::NUMERIC, 0);
      v_cost := COALESCE((v_item->>'cost')::NUMERIC, 0);
      v_name := v_item->>'name';
      IF v_price < 0 OR v_cost < 0 THEN RAISE EXCEPTION 'Price/cost must be non-negative'; END IF;
    END IF;
    v_subtotal := v_subtotal + (v_qty * v_price);
    v_cost_total := v_cost_total + (v_qty * v_cost);
  END LOOP;

  IF v_discount > v_subtotal THEN RAISE EXCEPTION 'Discount exceeds subtotal'; END IF;

  v_total := v_subtotal + v_tax - v_discount;
  v_change := GREATEST(v_paid - v_total, 0);
  IF v_paid >= v_total THEN v_status := 'completed'; ELSE v_status := 'credit'; END IF;

  INSERT INTO public.sales (tenant_id, customer_id, expense_person_id, cashier_id, subtotal, tax, discount, total, cost_total, paid, change_due, payment_method, status, note)
  VALUES (v_tenant, v_customer, v_person, v_uid, v_subtotal, v_tax, v_discount, v_total, v_cost_total, v_paid, v_change, v_method, v_status, payload->>'note')
  RETURNING id, invoice_no INTO v_sale_id, v_inv;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    IF v_pid IS NOT NULL THEN
      SELECT sell_price, cost_price, name INTO v_price, v_cost, v_name
        FROM public.products WHERE id = v_pid;
    ELSE
      v_price := COALESCE((v_item->>'price')::NUMERIC, 0);
      v_cost := COALESCE((v_item->>'cost')::NUMERIC, 0);
      v_name := v_item->>'name';
    END IF;
    INSERT INTO public.sale_items (tenant_id, sale_id, product_id, name, qty, price, cost, line_total)
    VALUES (v_tenant, v_sale_id, v_pid, v_name, v_qty, v_price, v_cost, v_qty * v_price);
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET stock = stock - v_qty, updated_at = now() WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_status = 'credit' AND v_customer IS NOT NULL THEN
    UPDATE public.customers SET balance = balance + (v_total - v_paid) WHERE id = v_customer;
  END IF;

  IF v_person IS NOT NULL THEN
    INSERT INTO public.expenses (tenant_id, person_id, sale_id, category, amount, description, method, expense_date, user_id)
    VALUES (v_tenant, v_person, v_sale_id, 'staff_purchase', v_total,
            'Mart purchase · invoice ' || COALESCE(v_inv, v_sale_id::text),
            v_method, CURRENT_DATE, v_uid);
  END IF;

  RETURN v_sale_id;
END; $function$;

-- 4) RPC: complete_purchase
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
  v_new_avg NUMERIC;
  v_ok BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF v_tax < 0 OR v_paid < 0 THEN RAISE EXCEPTION 'Tax and paid must be non-negative'; END IF;

  IF v_supplier IS NOT NULL THEN
    SELECT true INTO v_ok FROM public.suppliers WHERE id = v_supplier AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Supplier does not belong to current tenant'; END IF;
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

  INSERT INTO public.purchases (tenant_id, supplier_id, user_id, subtotal, tax, total, paid, note)
  VALUES (v_tenant, v_supplier, v_uid, v_subtotal, v_tax, v_total, v_paid, payload->>'note')
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
      IF COALESCE(v_old_stock,0) > 0 THEN
        v_new_avg := ((v_old_stock * COALESCE(v_old_cost,0)) + (v_qty * v_cost))
                     / (v_old_stock + v_qty);
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

-- 5) RPC: complete_sale_return
CREATE OR REPLACE FUNCTION public.complete_sale_return(payload jsonb)
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
  v_refund NUMERIC := COALESCE((payload->>'refund_amount')::NUMERIC, 0);
  v_total NUMERIC;
  v_sale UUID := NULLIF(payload->>'sale_id','')::UUID;
  v_customer UUID := NULLIF(payload->>'customer_id','')::UUID;
  v_method TEXT := COALESCE(payload->>'refund_method','cash');
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_pid UUID;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_cost NUMERIC;
  v_name TEXT;
  v_ok BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF v_tax < 0 OR v_refund < 0 THEN RAISE EXCEPTION 'Tax/refund must be non-negative'; END IF;

  IF v_sale IS NOT NULL THEN
    SELECT true INTO v_ok FROM public.sales WHERE id = v_sale AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Sale does not belong to current tenant'; END IF;
  END IF;
  IF v_customer IS NOT NULL THEN
    v_ok := NULL;
    SELECT true INTO v_ok FROM public.customers WHERE id = v_customer AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Customer does not belong to current tenant'; END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    v_price := COALESCE((v_item->>'price')::NUMERIC, 0);
    IF v_price < 0 THEN RAISE EXCEPTION 'Price must be non-negative'; END IF;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    IF v_pid IS NOT NULL THEN
      v_ok := NULL;
      SELECT true INTO v_ok FROM public.products WHERE id = v_pid AND tenant_id = v_tenant;
      IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Product % does not belong to current tenant', v_pid; END IF;
    END IF;
    v_subtotal := v_subtotal + (v_qty * v_price);
  END LOOP;

  v_total := v_subtotal + v_tax;
  IF v_refund > v_total THEN RAISE EXCEPTION 'Refund exceeds return total'; END IF;

  INSERT INTO public.sale_returns (tenant_id, sale_id, customer_id, user_id, subtotal, tax, total, refund_amount, refund_method, note, created_at)
  VALUES (v_tenant, v_sale, v_customer, v_uid, v_subtotal, v_tax, v_total, v_refund, v_method, payload->>'note', COALESCE(NULLIF(payload->>'created_at','')::timestamptz, now()))
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    v_price := COALESCE((v_item->>'price')::NUMERIC, 0);
    v_cost := COALESCE((v_item->>'cost')::NUMERIC, 0);
    v_name := COALESCE(v_item->>'name', 'Item');
    IF v_pid IS NOT NULL THEN
      SELECT name, cost_price INTO v_name, v_cost FROM public.products WHERE id = v_pid;
    END IF;
    INSERT INTO public.sale_return_items (tenant_id, return_id, product_id, name, qty, price, cost, line_total)
    VALUES (v_tenant, v_id, v_pid, v_name, v_qty, v_price, v_cost, v_qty * v_price);
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET stock = stock + v_qty, updated_at = now() WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_customer IS NOT NULL AND v_total > v_refund THEN
    UPDATE public.customers SET balance = balance - (v_total - v_refund) WHERE id = v_customer;
  END IF;

  RETURN v_id;
END; $function$;

-- 6) RPC: complete_purchase_return
CREATE OR REPLACE FUNCTION public.complete_purchase_return(payload jsonb)
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
  v_refund NUMERIC := COALESCE((payload->>'refund_amount')::NUMERIC, 0);
  v_total NUMERIC;
  v_purchase UUID := NULLIF(payload->>'purchase_id','')::UUID;
  v_supplier UUID := NULLIF(payload->>'supplier_id','')::UUID;
  v_method TEXT := COALESCE(payload->>'refund_method','cash');
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_pid UUID;
  v_qty NUMERIC;
  v_cost NUMERIC;
  v_name TEXT;
  v_stock NUMERIC;
  v_ok BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF v_tax < 0 OR v_refund < 0 THEN RAISE EXCEPTION 'Tax/refund must be non-negative'; END IF;

  IF v_purchase IS NOT NULL THEN
    SELECT true INTO v_ok FROM public.purchases WHERE id = v_purchase AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Purchase does not belong to current tenant'; END IF;
  END IF;
  IF v_supplier IS NOT NULL THEN
    v_ok := NULL;
    SELECT true INTO v_ok FROM public.suppliers WHERE id = v_supplier AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Supplier does not belong to current tenant'; END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_cost := COALESCE((v_item->>'cost')::NUMERIC, 0);
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    IF v_cost < 0 THEN RAISE EXCEPTION 'Cost must be non-negative'; END IF;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    IF v_pid IS NOT NULL THEN
      SELECT stock INTO v_stock FROM public.products WHERE id = v_pid AND tenant_id = v_tenant;
      IF v_stock IS NULL THEN RAISE EXCEPTION 'Unknown product % (or wrong tenant)', v_pid; END IF;
      IF v_stock < v_qty THEN RAISE EXCEPTION 'Insufficient stock to return for product %', v_pid; END IF;
    END IF;
    v_subtotal := v_subtotal + (v_qty * v_cost);
  END LOOP;

  v_total := v_subtotal + v_tax;
  IF v_refund > v_total THEN RAISE EXCEPTION 'Refund exceeds return total'; END IF;

  INSERT INTO public.purchase_returns (tenant_id, purchase_id, supplier_id, user_id, subtotal, tax, total, refund_amount, refund_method, note)
  VALUES (v_tenant, v_purchase, v_supplier, v_uid, v_subtotal, v_tax, v_total, v_refund, v_method, payload->>'note')
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    v_cost := COALESCE((v_item->>'cost')::NUMERIC, 0);
    v_name := COALESCE(v_item->>'name', 'Item');
    IF v_pid IS NOT NULL THEN
      SELECT name INTO v_name FROM public.products WHERE id = v_pid;
    END IF;
    INSERT INTO public.purchase_return_items (tenant_id, return_id, product_id, name, qty, cost, line_total)
    VALUES (v_tenant, v_id, v_pid, v_name, v_qty, v_cost, v_qty * v_cost);
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET stock = stock - v_qty, updated_at = now() WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_supplier IS NOT NULL AND v_total > v_refund THEN
    UPDATE public.suppliers SET balance = balance - (v_total - v_refund) WHERE id = v_supplier;
  END IF;

  RETURN v_id;
END; $function$;

-- 7) RPC: record_payment
CREATE OR REPLACE FUNCTION public.record_payment(p_party_type text, p_party_id uuid, p_amount numeric, p_method text, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_ok BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;
  IF p_party_type NOT IN ('customer','supplier') THEN
    RAISE EXCEPTION 'Invalid party type';
  END IF;

  IF p_party_type = 'customer' THEN
    SELECT true INTO v_ok FROM public.customers WHERE id = p_party_id AND tenant_id = v_tenant;
  ELSE
    SELECT true INTO v_ok FROM public.suppliers WHERE id = p_party_id AND tenant_id = v_tenant;
  END IF;
  IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Party does not belong to current tenant'; END IF;

  INSERT INTO public.party_payments (tenant_id, party_type, party_id, amount, method, note, user_id)
  VALUES (v_tenant, p_party_type, p_party_id, p_amount, COALESCE(p_method,'cash'), p_note, v_uid)
  RETURNING id INTO v_id;

  IF p_party_type = 'customer' THEN
    UPDATE public.customers SET balance = balance - p_amount WHERE id = p_party_id;
  ELSE
    UPDATE public.suppliers SET balance = balance - p_amount WHERE id = p_party_id;
  END IF;
  RETURN v_id;
END; $function$;

-- 8) RPC: update_party_payment — restrict to current tenant
CREATE OR REPLACE FUNCTION public.update_party_payment(_id uuid, _amount numeric, _method text, _note text, _created_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_old numeric; v_type text; v_party uuid; v_delta numeric; v_tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT amount, party_type, party_id INTO v_old, v_type, v_party
    FROM public.party_payments WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;

  v_delta := _amount - v_old;
  UPDATE public.party_payments
    SET amount = _amount,
        method = COALESCE(_method, method),
        note = _note,
        created_at = COALESCE(_created_at, created_at)
    WHERE id = _id;

  IF v_delta <> 0 THEN
    IF v_type = 'customer' THEN
      UPDATE public.customers SET balance = balance - v_delta WHERE id = v_party;
    ELSE
      UPDATE public.suppliers SET balance = balance - v_delta WHERE id = v_party;
    END IF;
  END IF;
END $function$;

-- 9) RPC: delete_party_payment — restrict to current tenant
CREATE OR REPLACE FUNCTION public.delete_party_payment(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_amount numeric; v_type text; v_party uuid; v_tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT amount, party_type, party_id INTO v_amount, v_type, v_party
    FROM public.party_payments WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
  IF v_amount IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;

  DELETE FROM public.party_payments WHERE id = _id;

  IF v_type = 'customer' THEN
    UPDATE public.customers SET balance = balance + v_amount WHERE id = v_party;
  ELSE
    UPDATE public.suppliers SET balance = balance + v_amount WHERE id = v_party;
  END IF;
END $function$;
