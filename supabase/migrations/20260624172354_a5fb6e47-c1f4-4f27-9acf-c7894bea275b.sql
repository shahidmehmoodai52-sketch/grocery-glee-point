
-- Fix #1: record_payment must reject non-positive amounts
CREATE OR REPLACE FUNCTION public.record_payment(p_party_type text, p_party_id uuid, p_amount numeric, p_method text, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id UUID; v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;
  IF p_party_type NOT IN ('customer','supplier') THEN
    RAISE EXCEPTION 'Invalid party type';
  END IF;
  INSERT INTO public.party_payments (party_type, party_id, amount, method, note, user_id)
  VALUES (p_party_type, p_party_id, p_amount, COALESCE(p_method,'cash'), p_note, v_uid)
  RETURNING id INTO v_id;
  IF p_party_type = 'customer' THEN
    UPDATE public.customers SET balance = balance - p_amount WHERE id = p_party_id;
  ELSE
    UPDATE public.suppliers SET balance = balance - p_amount WHERE id = p_party_id;
  END IF;
  RETURN v_id;
END; $function$;

-- Fix #2: complete_sale must trust DB prices for known products and validate inputs
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
  v_method TEXT := COALESCE(payload->>'payment_method','cash');
  v_uid UUID := auth.uid();
  v_pid UUID;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_cost NUMERIC;
  v_name TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tax < 0 OR v_discount < 0 OR v_paid < 0 THEN
    RAISE EXCEPTION 'Tax, discount, and paid must be non-negative';
  END IF;

  -- First pass: validate and compute totals from trusted sources
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    IF v_pid IS NOT NULL THEN
      SELECT sell_price, cost_price, name INTO v_price, v_cost, v_name
        FROM public.products WHERE id = v_pid AND is_active = true;
      IF v_price IS NULL THEN RAISE EXCEPTION 'Unknown or inactive product %', v_pid; END IF;
    ELSE
      -- Ad-hoc line: trust client price, but it must be non-negative
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

  INSERT INTO public.sales (customer_id, cashier_id, subtotal, tax, discount, total, cost_total, paid, change_due, payment_method, status, note)
  VALUES (v_customer, v_uid, v_subtotal, v_tax, v_discount, v_total, v_cost_total, v_paid, v_change, v_method, v_status, payload->>'note')
  RETURNING id INTO v_sale_id;

  -- Second pass: insert items using trusted prices and adjust stock
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
    INSERT INTO public.sale_items (sale_id, product_id, name, qty, price, cost, line_total)
    VALUES (v_sale_id, v_pid, v_name, v_qty, v_price, v_cost, v_qty * v_price);
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET stock = stock - v_qty, updated_at = now() WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_status = 'credit' AND v_customer IS NOT NULL THEN
    UPDATE public.customers SET balance = balance + (v_total - v_paid) WHERE id = v_customer;
  END IF;

  RETURN v_sale_id;
END; $function$;

-- Fix #2b: complete_purchase input validation. Purchase costs are legitimately
-- supplied by the user (new stock arrives at negotiated prices), so we validate
-- positivity but still accept the supplied cost.
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
  v_qty NUMERIC;
  v_cost NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tax < 0 OR v_paid < 0 THEN RAISE EXCEPTION 'Tax and paid must be non-negative'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_cost := (v_item->>'cost')::NUMERIC;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    IF v_cost IS NULL OR v_cost < 0 THEN RAISE EXCEPTION 'Cost must be non-negative'; END IF;
    v_subtotal := v_subtotal + (v_qty * v_cost);
  END LOOP;
  v_total := v_subtotal + v_tax;

  INSERT INTO public.purchases (supplier_id, user_id, subtotal, tax, total, paid, note)
  VALUES (v_supplier, v_uid, v_subtotal, v_tax, v_total, v_paid, payload->>'note')
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    INSERT INTO public.purchase_items (purchase_id, product_id, name, qty, cost, line_total)
    VALUES (
      v_id,
      NULLIF(v_item->>'product_id','')::UUID,
      v_item->>'name',
      (v_item->>'qty')::NUMERIC,
      (v_item->>'cost')::NUMERIC,
      (v_item->>'qty')::NUMERIC * (v_item->>'cost')::NUMERIC
    );
    IF NULLIF(v_item->>'product_id','') IS NOT NULL THEN
      UPDATE public.products SET
        stock = stock + (v_item->>'qty')::NUMERIC,
        cost_price = (v_item->>'cost')::NUMERIC,
        updated_at = now()
      WHERE id = (v_item->>'product_id')::UUID;
    END IF;
  END LOOP;

  IF v_total > v_paid AND v_supplier IS NOT NULL THEN
    UPDATE public.suppliers SET balance = balance + (v_total - v_paid) WHERE id = v_supplier;
  END IF;

  RETURN v_id;
END; $function$;

-- Fix #3: role separation at DB level. Cashiers can read/create but not delete
-- products/customers/suppliers, and cannot directly edit product prices/stock
-- (must go through complete_sale/complete_purchase).

-- products
DROP POLICY IF EXISTS products_all_auth ON public.products;
CREATE POLICY products_select_auth ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY products_insert_admin ON public.products FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY products_update_admin ON public.products FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY products_delete_admin ON public.products FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- customers
DROP POLICY IF EXISTS customers_all_auth ON public.customers;
CREATE POLICY customers_select_auth ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY customers_insert_auth ON public.customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY customers_update_auth ON public.customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY customers_delete_admin ON public.customers FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- suppliers
DROP POLICY IF EXISTS suppliers_all_auth ON public.suppliers;
CREATE POLICY suppliers_select_auth ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY suppliers_insert_auth ON public.suppliers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY suppliers_update_auth ON public.suppliers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY suppliers_delete_admin ON public.suppliers FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- sales / purchases / items / payments: writes only via SECURITY DEFINER RPCs.
-- Revoke direct write access so clients must use complete_sale/complete_purchase/record_payment.
DROP POLICY IF EXISTS sales_all_auth ON public.sales;
CREATE POLICY sales_select_auth ON public.sales FOR SELECT TO authenticated USING (true);
CREATE POLICY sales_delete_admin ON public.sales FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS sale_items_all_auth ON public.sale_items;
CREATE POLICY sale_items_select_auth ON public.sale_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS purchases_all_auth ON public.purchases;
CREATE POLICY purchases_select_auth ON public.purchases FOR SELECT TO authenticated USING (true);
CREATE POLICY purchases_delete_admin ON public.purchases FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS purchase_items_all_auth ON public.purchase_items;
CREATE POLICY purchase_items_select_auth ON public.purchase_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS party_payments_all_auth ON public.party_payments;
CREATE POLICY party_payments_select_auth ON public.party_payments FOR SELECT TO authenticated USING (true);
