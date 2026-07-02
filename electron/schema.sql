-- Local Postgres schema for POS desktop app. Runs once on first boot.
-- Mirrors cloud schema but replaces Supabase-only bits (auth.uid, RLS) with app-level equivalents.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Return the current app user (set by API via `SET LOCAL app.user_id = ...`)
CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- ============ Users / roles ============
CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text NOT NULL DEFAULT 'cashier',   -- admin | cashier | manager
  pin_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  perm text NOT NULL,
  UNIQUE (user_id, perm)
);

CREATE OR REPLACE FUNCTION has_permission(_uid uuid, _perm text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM app_users WHERE id=_uid AND role='admin')
      OR EXISTS(SELECT 1 FROM user_permissions WHERE user_id=_uid AND perm=_perm);
$$;

-- Seed admin PIN 1234 on first install; user must change from Users screen.
INSERT INTO app_users (name, role, pin_hash)
SELECT 'Owner', 'admin', crypt('1234', gen_salt('bf'))
WHERE NOT EXISTS (SELECT 1 FROM app_users);

-- ============ Core tables ============
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, phone text, email text, address text,
  balance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, phone text, email text, address text,
  balance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, sku text UNIQUE, barcode text, category text, unit text DEFAULT 'pcs',
  cost_price numeric NOT NULL DEFAULT 0,
  sell_price numeric NOT NULL DEFAULT 0,
  mrp numeric, tax_rate numeric DEFAULT 0,
  stock numeric NOT NULL DEFAULT 0,
  reorder_level numeric DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode text NOT NULL UNIQUE,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expense_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, role text, phone text, notes text,
  is_active boolean NOT NULL DEFAULT true,
  user_id uuid NOT NULL DEFAULT current_user_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid REFERENCES expense_persons(id) ON DELETE SET NULL,
  sale_id uuid,
  category text NOT NULL DEFAULT 'general',
  amount numeric NOT NULL,
  description text,
  method text NOT NULL DEFAULT 'cash',
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  user_id uuid NOT NULL DEFAULT current_user_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sales
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1000;
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text UNIQUE NOT NULL DEFAULT ('INV-' || nextval('invoice_seq')::text),
  customer_id uuid REFERENCES customers(id),
  expense_person_id uuid REFERENCES expense_persons(id),
  cashier_id uuid,
  subtotal numeric NOT NULL, tax numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL, cost_total numeric NOT NULL DEFAULT 0,
  paid numeric NOT NULL DEFAULT 0, change_due numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash',
  status text NOT NULL DEFAULT 'completed',
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  name text NOT NULL, qty numeric NOT NULL,
  price numeric NOT NULL, cost numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no text UNIQUE NOT NULL DEFAULT ('SR-' || nextval('invoice_seq')::text),
  sale_id uuid REFERENCES sales(id), customer_id uuid REFERENCES customers(id),
  user_id uuid, subtotal numeric NOT NULL, tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL, refund_amount numeric NOT NULL DEFAULT 0,
  refund_method text NOT NULL DEFAULT 'cash', note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sale_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  product_id uuid, name text NOT NULL, qty numeric NOT NULL,
  price numeric NOT NULL, cost numeric NOT NULL DEFAULT 0, line_total numeric NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no text UNIQUE NOT NULL DEFAULT ('P-' || nextval('invoice_seq')::text),
  supplier_id uuid REFERENCES suppliers(id), user_id uuid,
  subtotal numeric NOT NULL, tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL, paid numeric NOT NULL DEFAULT 0,
  note text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  name text NOT NULL, qty numeric NOT NULL, cost numeric NOT NULL, line_total numeric NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no text UNIQUE NOT NULL DEFAULT ('PR-' || nextval('invoice_seq')::text),
  purchase_id uuid REFERENCES purchases(id), supplier_id uuid REFERENCES suppliers(id),
  user_id uuid, subtotal numeric NOT NULL, tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL, refund_amount numeric NOT NULL DEFAULT 0,
  refund_method text NOT NULL DEFAULT 'cash', note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  product_id uuid, name text NOT NULL, qty numeric NOT NULL,
  cost numeric NOT NULL, line_total numeric NOT NULL
);

CREATE TABLE IF NOT EXISTS party_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type text NOT NULL, party_id uuid NOT NULL,
  amount numeric NOT NULL, method text NOT NULL DEFAULT 'cash',
  note text, user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name text, tagline text, address text, phone text, email text,
  gstin text, logo_url text, paper_width text DEFAULT '80mm',
  footer_note text, currency text DEFAULT 'PKR', tax_rate numeric DEFAULT 0,
  show_barcode boolean DEFAULT true, show_tax_lines boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============ Business RPCs (identical logic to cloud) ============
-- record_payment
CREATE OR REPLACE FUNCTION record_payment(p_party_type text, p_party_id uuid, p_amount numeric, p_method text, p_note text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_uid uuid := current_user_id();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be positive'; END IF;
  IF p_party_type NOT IN ('customer','supplier') THEN RAISE EXCEPTION 'Invalid party type'; END IF;
  INSERT INTO party_payments (party_type, party_id, amount, method, note, user_id)
  VALUES (p_party_type, p_party_id, p_amount, COALESCE(p_method,'cash'), p_note, v_uid)
  RETURNING id INTO v_id;
  IF p_party_type = 'customer' THEN UPDATE customers SET balance = balance - p_amount WHERE id = p_party_id;
  ELSE UPDATE suppliers SET balance = balance - p_amount WHERE id = p_party_id; END IF;
  RETURN v_id;
END $$;

-- complete_sale (WAC-aware, credit ledger, staff-purchase auto-expense)
CREATE OR REPLACE FUNCTION complete_sale(payload jsonb) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_sale_id uuid; v_item jsonb;
  v_subtotal numeric := 0; v_cost_total numeric := 0;
  v_tax numeric := COALESCE((payload->>'tax')::numeric,0);
  v_discount numeric := COALESCE((payload->>'discount')::numeric,0);
  v_paid numeric := COALESCE((payload->>'paid')::numeric,0);
  v_total numeric; v_change numeric; v_status text;
  v_customer uuid := NULLIF(payload->>'customer_id','')::uuid;
  v_person uuid := NULLIF(payload->>'expense_person_id','')::uuid;
  v_method text := COALESCE(payload->>'payment_method','cash');
  v_uid uuid := current_user_id();
  v_pid uuid; v_qty numeric; v_price numeric; v_cost numeric; v_name text; v_inv text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::numeric;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Qty must be positive'; END IF;
    v_pid := NULLIF(v_item->>'product_id','')::uuid;
    IF v_pid IS NOT NULL THEN
      SELECT sell_price, cost_price, name INTO v_price, v_cost, v_name FROM products WHERE id=v_pid AND is_active=true;
      IF v_price IS NULL THEN RAISE EXCEPTION 'Unknown product %', v_pid; END IF;
    ELSE
      v_price := COALESCE((v_item->>'price')::numeric,0);
      v_cost := COALESCE((v_item->>'cost')::numeric,0);
      v_name := v_item->>'name';
    END IF;
    v_subtotal := v_subtotal + v_qty * v_price;
    v_cost_total := v_cost_total + v_qty * v_cost;
  END LOOP;
  IF v_discount > v_subtotal THEN RAISE EXCEPTION 'Discount exceeds subtotal'; END IF;
  v_total := v_subtotal + v_tax - v_discount;
  v_change := GREATEST(v_paid - v_total, 0);
  v_status := CASE WHEN v_paid >= v_total THEN 'completed' ELSE 'credit' END;
  INSERT INTO sales (customer_id, expense_person_id, cashier_id, subtotal, tax, discount, total, cost_total, paid, change_due, payment_method, status, note)
  VALUES (v_customer, v_person, v_uid, v_subtotal, v_tax, v_discount, v_total, v_cost_total, v_paid, v_change, v_method, v_status, payload->>'note')
  RETURNING id, invoice_no INTO v_sale_id, v_inv;
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::numeric;
    v_pid := NULLIF(v_item->>'product_id','')::uuid;
    IF v_pid IS NOT NULL THEN SELECT sell_price, cost_price, name INTO v_price, v_cost, v_name FROM products WHERE id=v_pid;
    ELSE v_price := COALESCE((v_item->>'price')::numeric,0); v_cost := COALESCE((v_item->>'cost')::numeric,0); v_name := v_item->>'name'; END IF;
    INSERT INTO sale_items (sale_id, product_id, name, qty, price, cost, line_total)
    VALUES (v_sale_id, v_pid, v_name, v_qty, v_price, v_cost, v_qty * v_price);
    IF v_pid IS NOT NULL THEN UPDATE products SET stock = stock - v_qty, updated_at=now() WHERE id=v_pid; END IF;
  END LOOP;
  IF v_status='credit' AND v_customer IS NOT NULL THEN UPDATE customers SET balance = balance + (v_total - v_paid) WHERE id=v_customer; END IF;
  IF v_person IS NOT NULL THEN
    INSERT INTO expenses (person_id, sale_id, category, amount, description, method, expense_date, user_id)
    VALUES (v_person, v_sale_id, 'staff_purchase', v_total, 'Mart purchase · invoice ' || v_inv, v_method, CURRENT_DATE, v_uid);
  END IF;
  RETURN v_sale_id;
END $$;

-- complete_purchase (WAC)
CREATE OR REPLACE FUNCTION complete_purchase(payload jsonb) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid; v_item jsonb;
  v_subtotal numeric := 0;
  v_tax numeric := COALESCE((payload->>'tax')::numeric,0);
  v_paid numeric := COALESCE((payload->>'paid')::numeric,0);
  v_total numeric; v_supplier uuid := NULLIF(payload->>'supplier_id','')::uuid;
  v_uid uuid := current_user_id();
  v_qty numeric; v_cost numeric; v_pid uuid; v_old_stock numeric; v_old_cost numeric; v_new_avg numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::numeric; v_cost := (v_item->>'cost')::numeric;
    IF v_qty <= 0 OR v_cost < 0 THEN RAISE EXCEPTION 'Bad qty/cost'; END IF;
    v_subtotal := v_subtotal + v_qty * v_cost;
  END LOOP;
  v_total := v_subtotal + v_tax;
  INSERT INTO purchases (supplier_id, user_id, subtotal, tax, total, paid, note)
  VALUES (v_supplier, v_uid, v_subtotal, v_tax, v_total, v_paid, payload->>'note') RETURNING id INTO v_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::numeric; v_cost := (v_item->>'cost')::numeric;
    v_pid := NULLIF(v_item->>'product_id','')::uuid;
    INSERT INTO purchase_items (purchase_id, product_id, name, qty, cost, line_total)
    VALUES (v_id, v_pid, v_item->>'name', v_qty, v_cost, v_qty * v_cost);
    IF v_pid IS NOT NULL THEN
      SELECT stock, cost_price INTO v_old_stock, v_old_cost FROM products WHERE id=v_pid FOR UPDATE;
      IF COALESCE(v_old_stock,0) > 0 THEN v_new_avg := ((v_old_stock * COALESCE(v_old_cost,0)) + (v_qty * v_cost)) / (v_old_stock + v_qty);
      ELSE v_new_avg := v_cost; END IF;
      UPDATE products SET stock = COALESCE(stock,0) + v_qty, cost_price = ROUND(v_new_avg::numeric, 4), updated_at=now() WHERE id=v_pid;
    END IF;
  END LOOP;
  IF v_total > v_paid AND v_supplier IS NOT NULL THEN UPDATE suppliers SET balance = balance + (v_total - v_paid) WHERE id=v_supplier; END IF;
  RETURN v_id;
END $$;

-- complete_sale_return
CREATE OR REPLACE FUNCTION complete_sale_return(payload jsonb) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid; v_item jsonb;
  v_subtotal numeric := 0; v_tax numeric := COALESCE((payload->>'tax')::numeric,0);
  v_refund numeric := COALESCE((payload->>'refund_amount')::numeric,0);
  v_total numeric; v_sale uuid := NULLIF(payload->>'sale_id','')::uuid;
  v_customer uuid := NULLIF(payload->>'customer_id','')::uuid;
  v_method text := COALESCE(payload->>'refund_method','cash');
  v_uid uuid := current_user_id();
  v_pid uuid; v_qty numeric; v_price numeric; v_cost numeric; v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::numeric; v_price := COALESCE((v_item->>'price')::numeric,0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Bad qty'; END IF;
    v_subtotal := v_subtotal + v_qty * v_price;
  END LOOP;
  v_total := v_subtotal + v_tax;
  IF v_refund > v_total THEN RAISE EXCEPTION 'Refund exceeds total'; END IF;
  INSERT INTO sale_returns (sale_id, customer_id, user_id, subtotal, tax, total, refund_amount, refund_method, note)
  VALUES (v_sale, v_customer, v_uid, v_subtotal, v_tax, v_total, v_refund, v_method, payload->>'note') RETURNING id INTO v_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::numeric; v_pid := NULLIF(v_item->>'product_id','')::uuid;
    v_price := COALESCE((v_item->>'price')::numeric,0);
    v_cost := COALESCE((v_item->>'cost')::numeric,0); v_name := COALESCE(v_item->>'name','Item');
    IF v_pid IS NOT NULL THEN SELECT name, cost_price INTO v_name, v_cost FROM products WHERE id=v_pid; END IF;
    INSERT INTO sale_return_items (return_id, product_id, name, qty, price, cost, line_total)
    VALUES (v_id, v_pid, v_name, v_qty, v_price, v_cost, v_qty * v_price);
    IF v_pid IS NOT NULL THEN UPDATE products SET stock = stock + v_qty, updated_at=now() WHERE id=v_pid; END IF;
  END LOOP;
  IF v_customer IS NOT NULL AND v_total > v_refund THEN UPDATE customers SET balance = balance - (v_total - v_refund) WHERE id=v_customer; END IF;
  RETURN v_id;
END $$;

-- complete_purchase_return
CREATE OR REPLACE FUNCTION complete_purchase_return(payload jsonb) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid; v_item jsonb;
  v_subtotal numeric := 0; v_tax numeric := COALESCE((payload->>'tax')::numeric,0);
  v_refund numeric := COALESCE((payload->>'refund_amount')::numeric,0);
  v_total numeric; v_purchase uuid := NULLIF(payload->>'purchase_id','')::uuid;
  v_supplier uuid := NULLIF(payload->>'supplier_id','')::uuid;
  v_method text := COALESCE(payload->>'refund_method','cash');
  v_uid uuid := current_user_id();
  v_pid uuid; v_qty numeric; v_cost numeric; v_name text; v_stock numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::numeric; v_cost := COALESCE((v_item->>'cost')::numeric,0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Bad qty'; END IF;
    v_pid := NULLIF(v_item->>'product_id','')::uuid;
    IF v_pid IS NOT NULL THEN
      SELECT stock INTO v_stock FROM products WHERE id=v_pid;
      IF v_stock IS NULL THEN RAISE EXCEPTION 'Unknown product'; END IF;
      IF v_stock < v_qty THEN RAISE EXCEPTION 'Insufficient stock to return'; END IF;
    END IF;
    v_subtotal := v_subtotal + v_qty * v_cost;
  END LOOP;
  v_total := v_subtotal + v_tax;
  IF v_refund > v_total THEN RAISE EXCEPTION 'Refund exceeds total'; END IF;
  INSERT INTO purchase_returns (purchase_id, supplier_id, user_id, subtotal, tax, total, refund_amount, refund_method, note)
  VALUES (v_purchase, v_supplier, v_uid, v_subtotal, v_tax, v_total, v_refund, v_method, payload->>'note') RETURNING id INTO v_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::numeric; v_pid := NULLIF(v_item->>'product_id','')::uuid;
    v_cost := COALESCE((v_item->>'cost')::numeric,0); v_name := COALESCE(v_item->>'name','Item');
    IF v_pid IS NOT NULL THEN SELECT name INTO v_name FROM products WHERE id=v_pid; END IF;
    INSERT INTO purchase_return_items (return_id, product_id, name, qty, cost, line_total)
    VALUES (v_id, v_pid, v_name, v_qty, v_cost, v_qty * v_cost);
    IF v_pid IS NOT NULL THEN UPDATE products SET stock = stock - v_qty, updated_at=now() WHERE id=v_pid; END IF;
  END LOOP;
  IF v_supplier IS NOT NULL AND v_total > v_refund THEN UPDATE suppliers SET balance = balance - (v_total - v_refund) WHERE id=v_supplier; END IF;
  RETURN v_id;
END $$;

INSERT INTO store_settings (store_name, tagline, address, phone)
SELECT 'My Grocery Mart', 'Fresh · Local · Affordable', '—', '—'
WHERE NOT EXISTS (SELECT 1 FROM store_settings);
