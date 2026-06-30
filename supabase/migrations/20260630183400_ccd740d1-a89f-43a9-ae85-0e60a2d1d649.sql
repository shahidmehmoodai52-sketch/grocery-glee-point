
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS expense_person_id uuid REFERENCES public.expense_persons(id);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_expense_person ON public.sales(expense_person_id);
CREATE INDEX IF NOT EXISTS idx_expenses_sale ON public.expenses(sale_id);

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
  v_pid UUID;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_cost NUMERIC;
  v_name TEXT;
  v_inv TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tax < 0 OR v_discount < 0 OR v_paid < 0 THEN
    RAISE EXCEPTION 'Tax, discount, and paid must be non-negative';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    IF v_pid IS NOT NULL THEN
      SELECT sell_price, cost_price, name INTO v_price, v_cost, v_name
        FROM public.products WHERE id = v_pid AND is_active = true;
      IF v_price IS NULL THEN RAISE EXCEPTION 'Unknown or inactive product %', v_pid; END IF;
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

  INSERT INTO public.sales (customer_id, expense_person_id, cashier_id, subtotal, tax, discount, total, cost_total, paid, change_due, payment_method, status, note)
  VALUES (v_customer, v_person, v_uid, v_subtotal, v_tax, v_discount, v_total, v_cost_total, v_paid, v_change, v_method, v_status, payload->>'note')
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
    INSERT INTO public.sale_items (sale_id, product_id, name, qty, price, cost, line_total)
    VALUES (v_sale_id, v_pid, v_name, v_qty, v_price, v_cost, v_qty * v_price);
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET stock = stock - v_qty, updated_at = now() WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_status = 'credit' AND v_customer IS NOT NULL THEN
    UPDATE public.customers SET balance = balance + (v_total - v_paid) WHERE id = v_customer;
  END IF;

  -- Staff/owner purchase → auto-create an expense entry for the full bill
  IF v_person IS NOT NULL THEN
    INSERT INTO public.expenses (person_id, sale_id, category, amount, description, method, expense_date, user_id)
    VALUES (v_person, v_sale_id, 'staff_purchase', v_total,
            'Mart purchase · invoice ' || COALESCE(v_inv, v_sale_id::text),
            v_method, CURRENT_DATE, v_uid);
  END IF;

  RETURN v_sale_id;
END; $function$;
