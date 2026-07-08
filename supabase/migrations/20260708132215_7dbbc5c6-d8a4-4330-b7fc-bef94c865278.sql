
-- ============================================================
-- Sprint 6C: Expiry, Damage & Waste Management
-- ============================================================

-- 1. Extend enums (safe if already exists)
DO $$ BEGIN
  ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'waste';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'donation';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'internal_use';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.inventory_reference_type ADD VALUE IF NOT EXISTS 'damage';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.inventory_reference_type ADD VALUE IF NOT EXISTS 'waste';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.inventory_reference_type ADD VALUE IF NOT EXISTS 'batch';
EXCEPTION WHEN others THEN NULL; END $$;

-- 2. Products: opt-in batch tracking
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS track_batches BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER;

-- 3. Purchase items: optional batch fields (backward compatible)
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS batch_no TEXT,
  ADD COLUMN IF NOT EXISTS expiry_date DATE,
  ADD COLUMN IF NOT EXISTS mfg_date DATE;

-- 4. Store settings: configurable thresholds
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS expiring_soon_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS critical_days INTEGER NOT NULL DEFAULT 7;

-- 5. Product batches
CREATE TABLE IF NOT EXISTS public.product_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  batch_no TEXT,
  purchase_date DATE,
  expiry_date DATE,
  mfg_date DATE,
  qty_initial NUMERIC NOT NULL DEFAULT 0,
  qty_remaining NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  purchase_id UUID REFERENCES public.purchases(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_batches TO authenticated;
GRANT ALL ON public.product_batches TO service_role;
ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_batches_tenant_product ON public.product_batches(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON public.product_batches(tenant_id, expiry_date) WHERE qty_remaining > 0;
CREATE INDEX IF NOT EXISTS idx_batches_active ON public.product_batches(tenant_id, product_id, expiry_date) WHERE qty_remaining > 0 AND status = 'active';

DROP POLICY IF EXISTS batches_select ON public.product_batches;
CREATE POLICY batches_select ON public.product_batches FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS batches_write ON public.product_batches;
CREATE POLICY batches_write ON public.product_batches FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP TRIGGER IF EXISTS trg_batches_fill_tenant ON public.product_batches;
CREATE TRIGGER trg_batches_fill_tenant BEFORE INSERT ON public.product_batches
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenant_id();
DROP TRIGGER IF EXISTS trg_batches_touch ON public.product_batches;
CREATE TRIGGER trg_batches_touch BEFORE UPDATE ON public.product_batches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 6. Damage log
CREATE TABLE IF NOT EXISTS public.inventory_damages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES public.product_batches(id) ON DELETE SET NULL,
  qty NUMERIC NOT NULL CHECK (qty > 0),
  damage_type TEXT NOT NULL,
  unit_cost NUMERIC,
  total_value NUMERIC,
  reason TEXT,
  note TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_damages TO authenticated;
GRANT ALL ON public.inventory_damages TO service_role;
ALTER TABLE public.inventory_damages ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_damages_tenant ON public.inventory_damages(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_damages_product ON public.inventory_damages(tenant_id, product_id);

DROP POLICY IF EXISTS damages_select ON public.inventory_damages;
CREATE POLICY damages_select ON public.inventory_damages FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS damages_write ON public.inventory_damages;
CREATE POLICY damages_write ON public.inventory_damages FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND
         (public.has_role(auth.uid(),'admin') OR public.has_permission(auth.uid(),'products')))
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP TRIGGER IF EXISTS trg_damages_fill_tenant ON public.inventory_damages;
CREATE TRIGGER trg_damages_fill_tenant BEFORE INSERT ON public.inventory_damages
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenant_id();

-- 7. Waste log
CREATE TABLE IF NOT EXISTS public.inventory_waste (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES public.product_batches(id) ON DELETE SET NULL,
  qty NUMERIC NOT NULL CHECK (qty > 0),
  waste_type TEXT NOT NULL, -- expired, damaged, disposal, donation, internal_use
  unit_cost NUMERIC,
  total_value NUMERIC,
  reason TEXT,
  note TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_waste TO authenticated;
GRANT ALL ON public.inventory_waste TO service_role;
ALTER TABLE public.inventory_waste ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_waste_tenant ON public.inventory_waste(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waste_product ON public.inventory_waste(tenant_id, product_id);

DROP POLICY IF EXISTS waste_select ON public.inventory_waste;
CREATE POLICY waste_select ON public.inventory_waste FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS waste_write ON public.inventory_waste;
CREATE POLICY waste_write ON public.inventory_waste FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND
         (public.has_role(auth.uid(),'admin') OR public.has_permission(auth.uid(),'products')))
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP TRIGGER IF EXISTS trg_waste_fill_tenant ON public.inventory_waste;
CREATE TRIGGER trg_waste_fill_tenant BEFORE INSERT ON public.inventory_waste
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenant_id();

-- 8. Helper: FEFO consume batches for a product
CREATE OR REPLACE FUNCTION public.consume_batches_fefo(_product_id UUID, _qty NUMERIC)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining NUMERIC := _qty;
  v_take NUMERIC;
  v_batch RECORD;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RETURN; END IF;
  FOR v_batch IN
    SELECT id, qty_remaining
      FROM public.product_batches
     WHERE product_id = _product_id
       AND qty_remaining > 0
       AND status = 'active'
     ORDER BY COALESCE(expiry_date, DATE '9999-12-31') ASC, created_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_batch.qty_remaining, v_remaining);
    UPDATE public.product_batches
       SET qty_remaining = qty_remaining - v_take,
           status = CASE WHEN (qty_remaining - v_take) <= 0 THEN 'depleted' ELSE status END,
           updated_at = now()
     WHERE id = v_batch.id;
    v_remaining := v_remaining - v_take;
  END LOOP;
END $$;

-- 9. Trigger: create batch when purchase_item has expiry_date
CREATE OR REPLACE FUNCTION public.trg_purchase_item_batch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p RECORD;
  v_track BOOLEAN;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.expiry_date IS NULL AND NEW.batch_no IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(track_batches, FALSE) INTO v_track FROM public.products WHERE id = NEW.product_id;
  IF NOT v_track THEN RETURN NEW; END IF;

  SELECT supplier_id, id INTO v_p FROM public.purchases WHERE id = NEW.purchase_id;

  INSERT INTO public.product_batches
    (tenant_id, product_id, batch_no, purchase_date, expiry_date,
     qty_initial, qty_remaining, unit_cost, supplier_id, purchase_id)
  VALUES
    (NEW.tenant_id, NEW.product_id, NEW.batch_no, CURRENT_DATE, NEW.expiry_date,
     NEW.qty, NEW.qty, NEW.cost, v_p.supplier_id, v_p.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_item_batch ON public.purchase_items;
CREATE TRIGGER trg_purchase_item_batch AFTER INSERT ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_purchase_item_batch();

-- 10. Trigger: FEFO consume on sale
CREATE OR REPLACE FUNCTION public.trg_sale_item_fefo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has BOOLEAN;
BEGIN
  IF NEW.product_id IS NULL OR NEW.qty <= 0 THEN RETURN NEW; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.product_batches
     WHERE product_id = NEW.product_id AND qty_remaining > 0 AND status = 'active'
  ) INTO v_has;
  IF v_has THEN
    PERFORM public.consume_batches_fefo(NEW.product_id, NEW.qty);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sale_item_fefo ON public.sale_items;
CREATE TRIGGER trg_sale_item_fefo AFTER INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_item_fefo();

-- 11. RPC: record damage
CREATE OR REPLACE FUNCTION public.record_damage(
  _product_id UUID,
  _qty NUMERIC,
  _damage_type TEXT,
  _batch_id UUID,
  _reason TEXT,
  _note TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_cost NUMERIC;
  v_stock NUMERIC;
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;

  SELECT COALESCE(cost_price,0), COALESCE(stock,0) INTO v_cost, v_stock
    FROM public.products WHERE id = _product_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_cost IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF v_stock < _qty THEN RAISE EXCEPTION 'Insufficient stock (% available)', v_stock; END IF;

  UPDATE public.products SET stock = stock - _qty, updated_at = now() WHERE id = _product_id;

  IF _batch_id IS NOT NULL THEN
    UPDATE public.product_batches
      SET qty_remaining = GREATEST(qty_remaining - _qty, 0),
          status = CASE WHEN (qty_remaining - _qty) <= 0 THEN 'depleted' ELSE status END,
          updated_at = now()
      WHERE id = _batch_id AND tenant_id = v_tenant;
  END IF;

  INSERT INTO public.inventory_damages
    (tenant_id, product_id, batch_id, qty, damage_type, unit_cost, total_value, reason, note, user_id)
  VALUES
    (v_tenant, _product_id, _batch_id, _qty, _damage_type, v_cost, v_cost * _qty, _reason, _note, v_uid)
  RETURNING id INTO v_id;

  PERFORM public.record_inventory_movement(
    v_tenant, _product_id, 'damaged', 'damage',
    v_id, NULL, -_qty, v_cost,
    v_uid, NULL, NULL,
    COALESCE(_damage_type, 'damaged'), _note
  );
  RETURN v_id;
END $$;

-- 12. RPC: record waste (expired / disposal / donation / internal_use)
CREATE OR REPLACE FUNCTION public.record_waste(
  _product_id UUID,
  _qty NUMERIC,
  _waste_type TEXT,
  _batch_id UUID,
  _reason TEXT,
  _note TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_cost NUMERIC;
  v_stock NUMERIC;
  v_id UUID;
  v_mtype public.inventory_movement_type;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;

  SELECT COALESCE(cost_price,0), COALESCE(stock,0) INTO v_cost, v_stock
    FROM public.products WHERE id = _product_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_cost IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF v_stock < _qty THEN RAISE EXCEPTION 'Insufficient stock (% available)', v_stock; END IF;

  UPDATE public.products SET stock = stock - _qty, updated_at = now() WHERE id = _product_id;

  IF _batch_id IS NOT NULL THEN
    UPDATE public.product_batches
      SET qty_remaining = GREATEST(qty_remaining - _qty, 0),
          status = CASE WHEN (qty_remaining - _qty) <= 0 THEN 'depleted' ELSE status END,
          updated_at = now()
      WHERE id = _batch_id AND tenant_id = v_tenant;
  END IF;

  INSERT INTO public.inventory_waste
    (tenant_id, product_id, batch_id, qty, waste_type, unit_cost, total_value, reason, note, user_id)
  VALUES
    (v_tenant, _product_id, _batch_id, _qty, _waste_type, v_cost, v_cost * _qty, _reason, _note, v_uid)
  RETURNING id INTO v_id;

  v_mtype := CASE _waste_type
    WHEN 'expired' THEN 'expired'::public.inventory_movement_type
    WHEN 'damaged' THEN 'damaged'::public.inventory_movement_type
    WHEN 'donation' THEN 'donation'::public.inventory_movement_type
    WHEN 'internal_use' THEN 'internal_use'::public.inventory_movement_type
    ELSE 'waste'::public.inventory_movement_type
  END;

  PERFORM public.record_inventory_movement(
    v_tenant, _product_id, v_mtype, 'waste',
    v_id, NULL, -_qty, v_cost,
    v_uid, NULL, NULL,
    COALESCE(_waste_type,'waste'), _note
  );
  RETURN v_id;
END $$;

-- 13. RPC: manually create/adjust batch (opening balance style)
CREATE OR REPLACE FUNCTION public.create_product_batch(
  _product_id UUID,
  _batch_no TEXT,
  _qty NUMERIC,
  _expiry_date DATE,
  _mfg_date DATE,
  _unit_cost NUMERIC,
  _supplier_id UUID,
  _note TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID := public.current_tenant_id();
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;

  INSERT INTO public.product_batches
    (tenant_id, product_id, batch_no, purchase_date, expiry_date, mfg_date,
     qty_initial, qty_remaining, unit_cost, supplier_id, note)
  VALUES
    (v_tenant, _product_id, _batch_no, CURRENT_DATE, _expiry_date, _mfg_date,
     _qty, _qty, _unit_cost, _supplier_id, _note)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 14. View: expiry classification
CREATE OR REPLACE VIEW public.product_batch_status AS
SELECT
  b.id,
  b.tenant_id,
  b.product_id,
  p.name AS product_name,
  p.sku,
  p.unit,
  b.batch_no,
  b.purchase_date,
  b.expiry_date,
  b.qty_remaining,
  b.qty_initial,
  b.unit_cost,
  (b.qty_remaining * COALESCE(b.unit_cost, p.cost_price, 0))::numeric AS value_remaining,
  b.supplier_id,
  b.status,
  CASE
    WHEN b.expiry_date IS NULL THEN NULL
    ELSE (b.expiry_date - CURRENT_DATE)
  END AS days_remaining,
  CASE
    WHEN b.expiry_date IS NULL THEN 'no_expiry'
    WHEN b.expiry_date < CURRENT_DATE THEN 'expired'
    WHEN b.expiry_date - CURRENT_DATE <= COALESCE((SELECT critical_days FROM public.store_settings s WHERE s.tenant_id = b.tenant_id LIMIT 1), 7) THEN 'critical'
    WHEN b.expiry_date - CURRENT_DATE <= COALESCE((SELECT expiring_soon_days FROM public.store_settings s WHERE s.tenant_id = b.tenant_id LIMIT 1), 30) THEN 'expiring_soon'
    ELSE 'fresh'
  END AS expiry_status
FROM public.product_batches b
JOIN public.products p ON p.id = b.product_id
WHERE b.qty_remaining > 0 AND b.status = 'active';

GRANT SELECT ON public.product_batch_status TO authenticated;
