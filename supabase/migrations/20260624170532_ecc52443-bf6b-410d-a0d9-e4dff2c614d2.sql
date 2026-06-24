
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'cashier');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_read_all_auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles_read_all_auth" ON public.user_roles FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Auto profile + first user becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE user_count INT;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'cashier');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Settings (single row, store config)
CREATE TABLE public.store_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  store_name TEXT NOT NULL DEFAULT 'My Grocery Store',
  currency TEXT NOT NULL DEFAULT 'USD',
  currency_symbol TEXT NOT NULL DEFAULT '$',
  tax_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  address TEXT,
  phone TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.store_settings TO authenticated;
GRANT ALL ON public.store_settings TO service_role;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_read_auth" ON public.store_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_write_admin" ON public.store_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.store_settings (id) VALUES (1);

-- Products
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  barcode TEXT,
  category TEXT,
  unit TEXT DEFAULT 'pcs',
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  sell_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX products_name_idx ON public.products (lower(name));
CREATE INDEX products_barcode_idx ON public.products (barcode);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_all_auth" ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Customers
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0, -- positive = customer owes us
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers_all_auth" ON public.customers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Suppliers
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0, -- positive = we owe supplier
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suppliers_all_auth" ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Invoice number sequences
CREATE SEQUENCE public.sale_invoice_seq START 1000;
CREATE SEQUENCE public.purchase_invoice_seq START 1000;

-- Sales
CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL UNIQUE DEFAULT ('S-' || nextval('public.sale_invoice_seq')),
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  cashier_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  change_due NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'completed', -- completed | credit | void
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sales_created_idx ON public.sales (created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_all_auth" ON public.sales FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  qty NUMERIC(12,3) NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) NOT NULL
);
CREATE INDEX sale_items_sale_idx ON public.sale_items (sale_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_items TO authenticated;
GRANT ALL ON public.sale_items TO service_role;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sale_items_all_auth" ON public.sale_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Purchases
CREATE TABLE public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL UNIQUE DEFAULT ('P-' || nextval('public.purchase_invoice_seq')),
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX purchases_created_idx ON public.purchases (created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchases_all_auth" ON public.purchases FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  qty NUMERIC(12,3) NOT NULL,
  cost NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL
);
CREATE INDEX purchase_items_purchase_idx ON public.purchase_items (purchase_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_items TO authenticated;
GRANT ALL ON public.purchase_items TO service_role;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchase_items_all_auth" ON public.purchase_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Ledger payments (customer pays, or we pay supplier)
CREATE TABLE public.party_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type TEXT NOT NULL CHECK (party_type IN ('customer','supplier')),
  party_id UUID NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX party_payments_party_idx ON public.party_payments (party_type, party_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_payments TO authenticated;
GRANT ALL ON public.party_payments TO service_role;
ALTER TABLE public.party_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "party_payments_all_auth" ON public.party_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- RPC: complete a sale atomically (decrement stock, update customer balance if credit)
CREATE OR REPLACE FUNCTION public.complete_sale(payload JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::NUMERIC * (v_item->>'price')::NUMERIC);
    v_cost_total := v_cost_total + ((v_item->>'qty')::NUMERIC * COALESCE((v_item->>'cost')::NUMERIC, 0));
  END LOOP;

  v_total := v_subtotal + v_tax - v_discount;
  v_change := GREATEST(v_paid - v_total, 0);
  IF v_paid >= v_total THEN v_status := 'completed';
  ELSE v_status := 'credit'; END IF;

  INSERT INTO public.sales (customer_id, cashier_id, subtotal, tax, discount, total, cost_total, paid, change_due, payment_method, status, note)
  VALUES (v_customer, v_uid, v_subtotal, v_tax, v_discount, v_total, v_cost_total, v_paid, v_change, v_method, v_status, payload->>'note')
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    INSERT INTO public.sale_items (sale_id, product_id, name, qty, price, cost, line_total)
    VALUES (
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

  RETURN v_sale_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.complete_sale(JSONB) TO authenticated;

-- RPC: record purchase (increase stock, update supplier balance if unpaid)
CREATE OR REPLACE FUNCTION public.complete_purchase(payload JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_item JSONB;
  v_subtotal NUMERIC := 0;
  v_tax NUMERIC := COALESCE((payload->>'tax')::NUMERIC, 0);
  v_paid NUMERIC := COALESCE((payload->>'paid')::NUMERIC, 0);
  v_total NUMERIC;
  v_supplier UUID := NULLIF(payload->>'supplier_id','')::UUID;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::NUMERIC * (v_item->>'cost')::NUMERIC);
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
END; $$;
GRANT EXECUTE ON FUNCTION public.complete_purchase(JSONB) TO authenticated;

-- RPC: record payment against customer/supplier
CREATE OR REPLACE FUNCTION public.record_payment(p_party_type TEXT, p_party_id UUID, p_amount NUMERIC, p_method TEXT, p_note TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.party_payments (party_type, party_id, amount, method, note, user_id)
  VALUES (p_party_type, p_party_id, p_amount, COALESCE(p_method,'cash'), p_note, v_uid)
  RETURNING id INTO v_id;
  IF p_party_type = 'customer' THEN
    UPDATE public.customers SET balance = balance - p_amount WHERE id = p_party_id;
  ELSE
    UPDATE public.suppliers SET balance = balance - p_amount WHERE id = p_party_id;
  END IF;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.record_payment(TEXT, UUID, NUMERIC, TEXT, TEXT) TO authenticated;
