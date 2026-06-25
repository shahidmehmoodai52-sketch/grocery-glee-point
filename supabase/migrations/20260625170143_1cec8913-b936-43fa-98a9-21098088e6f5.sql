
CREATE SEQUENCE IF NOT EXISTS public.sale_return_seq START 1000;
CREATE SEQUENCE IF NOT EXISTS public.purchase_return_seq START 1000;

CREATE TABLE IF NOT EXISTS public.sale_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no TEXT NOT NULL UNIQUE DEFAULT ('SR-' || nextval('public.sale_return_seq')),
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sale_returns_created_idx ON public.sale_returns (created_at DESC);
GRANT SELECT ON public.sale_returns TO authenticated;
GRANT ALL ON public.sale_returns TO service_role;
ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_returns_select_auth ON public.sale_returns;
CREATE POLICY sale_returns_select_auth ON public.sale_returns FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS sale_returns_delete_admin ON public.sale_returns;
CREATE POLICY sale_returns_delete_admin ON public.sale_returns FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.sale_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.sale_returns(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  qty NUMERIC(12,3) NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS sri_return_idx ON public.sale_return_items (return_id);
GRANT SELECT ON public.sale_return_items TO authenticated;
GRANT ALL ON public.sale_return_items TO service_role;
ALTER TABLE public.sale_return_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sri_select_auth ON public.sale_return_items;
CREATE POLICY sri_select_auth ON public.sale_return_items FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.purchase_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no TEXT NOT NULL UNIQUE DEFAULT ('PR-' || nextval('public.purchase_return_seq')),
  purchase_id UUID REFERENCES public.purchases(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_returns_created_idx ON public.purchase_returns (created_at DESC);
GRANT SELECT ON public.purchase_returns TO authenticated;
GRANT ALL ON public.purchase_returns TO service_role;
ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_returns_select_auth ON public.purchase_returns;
CREATE POLICY purchase_returns_select_auth ON public.purchase_returns FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS purchase_returns_delete_admin ON public.purchase_returns;
CREATE POLICY purchase_returns_delete_admin ON public.purchase_returns FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.purchase_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  qty NUMERIC(12,3) NOT NULL,
  cost NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS pri_return_idx ON public.purchase_return_items (return_id);
GRANT SELECT ON public.purchase_return_items TO authenticated;
GRANT ALL ON public.purchase_return_items TO service_role;
ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pri_select_auth ON public.purchase_return_items;
CREATE POLICY pri_select_auth ON public.purchase_return_items FOR SELECT TO authenticated USING (true);

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
  v_pid UUID;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_cost NUMERIC;
  v_name TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tax < 0 OR v_refund < 0 THEN RAISE EXCEPTION 'Tax/refund must be non-negative'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    v_price := COALESCE((v_item->>'price')::NUMERIC, 0);
    IF v_price < 0 THEN RAISE EXCEPTION 'Price must be non-negative'; END IF;
    v_subtotal := v_subtotal + (v_qty * v_price);
  END LOOP;

  v_total := v_subtotal + v_tax;
  IF v_refund > v_total THEN RAISE EXCEPTION 'Refund exceeds return total'; END IF;

  INSERT INTO public.sale_returns (sale_id, customer_id, user_id, subtotal, tax, total, refund_amount, refund_method, note)
  VALUES (v_sale, v_customer, v_uid, v_subtotal, v_tax, v_total, v_refund, v_method, payload->>'note')
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
    INSERT INTO public.sale_return_items (return_id, product_id, name, qty, price, cost, line_total)
    VALUES (v_id, v_pid, v_name, v_qty, v_price, v_cost, v_qty * v_price);
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET stock = stock + v_qty, updated_at = now() WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_customer IS NOT NULL AND v_total > v_refund THEN
    UPDATE public.customers SET balance = balance - (v_total - v_refund) WHERE id = v_customer;
  END IF;

  RETURN v_id;
END; $function$;

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
  v_pid UUID;
  v_qty NUMERIC;
  v_cost NUMERIC;
  v_name TEXT;
  v_stock NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tax < 0 OR v_refund < 0 THEN RAISE EXCEPTION 'Tax/refund must be non-negative'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_cost := COALESCE((v_item->>'cost')::NUMERIC, 0);
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    IF v_cost < 0 THEN RAISE EXCEPTION 'Cost must be non-negative'; END IF;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    IF v_pid IS NOT NULL THEN
      SELECT stock INTO v_stock FROM public.products WHERE id = v_pid;
      IF v_stock IS NULL THEN RAISE EXCEPTION 'Unknown product %', v_pid; END IF;
      IF v_stock < v_qty THEN RAISE EXCEPTION 'Insufficient stock to return for product %', v_pid; END IF;
    END IF;
    v_subtotal := v_subtotal + (v_qty * v_cost);
  END LOOP;

  v_total := v_subtotal + v_tax;
  IF v_refund > v_total THEN RAISE EXCEPTION 'Refund exceeds return total'; END IF;

  INSERT INTO public.purchase_returns (purchase_id, supplier_id, user_id, subtotal, tax, total, refund_amount, refund_method, note)
  VALUES (v_purchase, v_supplier, v_uid, v_subtotal, v_tax, v_total, v_refund, v_method, payload->>'note')
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    v_cost := COALESCE((v_item->>'cost')::NUMERIC, 0);
    v_name := COALESCE(v_item->>'name', 'Item');
    IF v_pid IS NOT NULL THEN
      SELECT name INTO v_name FROM public.products WHERE id = v_pid;
    END IF;
    INSERT INTO public.purchase_return_items (return_id, product_id, name, qty, cost, line_total)
    VALUES (v_id, v_pid, v_name, v_qty, v_cost, v_qty * v_cost);
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET stock = stock - v_qty, updated_at = now() WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_supplier IS NOT NULL AND v_total > v_refund THEN
    UPDATE public.suppliers SET balance = balance - (v_total - v_refund) WHERE id = v_supplier;
  END IF;

  RETURN v_id;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.complete_sale_return(jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_return(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.complete_sale_return(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return(jsonb) TO authenticated;
