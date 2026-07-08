
CREATE TABLE public.global_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  barcode text UNIQUE,
  category text,
  unit text DEFAULT 'pcs',
  image_url text,
  description text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  contributed_by_tenant uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  contributed_by_user uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_global_products_status ON public.global_products(status);
CREATE INDEX idx_global_products_name ON public.global_products(lower(name));

GRANT SELECT, INSERT, UPDATE ON public.global_products TO authenticated;
GRANT ALL ON public.global_products TO service_role;

ALTER TABLE public.global_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read approved or own or admin" ON public.global_products
  FOR SELECT TO authenticated
  USING (
    status = 'approved'
    OR contributed_by_user = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "auth can contribute" ON public.global_products
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "admin can review" ON public.global_products
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Force new contributions to pending and stamp contributor
CREATE OR REPLACE FUNCTION public.enforce_global_product_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    NEW.status := 'pending';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;
  NEW.contributed_by_user := COALESCE(NEW.contributed_by_user, auth.uid());
  NEW.contributed_by_tenant := COALESCE(NEW.contributed_by_tenant, public.current_tenant_id());
  RETURN NEW;
END $$;

CREATE TRIGGER trg_enforce_global_product_insert
BEFORE INSERT ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.enforce_global_product_insert();

-- Stamp reviewer & updated_at
CREATE OR REPLACE FUNCTION public.stamp_global_product_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_stamp_global_product_review
BEFORE UPDATE ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.stamp_global_product_review();

-- Auto-contribute metadata whenever a tenant adds a product with a barcode
CREATE OR REPLACE FUNCTION public.auto_contribute_global_product()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bc text := NULLIF(trim(NEW.barcode), '');
BEGIN
  IF v_bc IS NOT NULL THEN
    INSERT INTO public.global_products (name, barcode, category, unit, status, contributed_by_tenant, contributed_by_user)
    VALUES (NEW.name, v_bc, NEW.category, COALESCE(NEW.unit, 'pcs'), 'pending', NEW.tenant_id, auth.uid())
    ON CONFLICT (barcode) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_auto_contribute_global_product
AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.auto_contribute_global_product();

-- Import an approved global item into the current tenant's catalog
CREATE OR REPLACE FUNCTION public.import_from_global_library(
  _global_id uuid,
  _sell_price numeric DEFAULT 0,
  _cost_price numeric DEFAULT 0,
  _stock numeric DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_g public.global_products%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;

  SELECT * INTO v_g FROM public.global_products WHERE id = _global_id AND status = 'approved';
  IF v_g.id IS NULL THEN RAISE EXCEPTION 'Global product not found or not approved'; END IF;

  IF v_g.barcode IS NOT NULL THEN
    SELECT id INTO v_id FROM public.products
      WHERE tenant_id = v_tenant AND barcode = v_g.barcode LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  INSERT INTO public.products (tenant_id, name, barcode, category, unit, sell_price, cost_price, stock, is_active)
  VALUES (v_tenant, v_g.name, v_g.barcode, v_g.category, COALESCE(v_g.unit, 'pcs'),
          COALESCE(_sell_price, 0), COALESCE(_cost_price, 0), COALESCE(_stock, 0), true)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;
