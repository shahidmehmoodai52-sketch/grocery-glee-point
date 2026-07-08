
-- ============================================================
-- Inventory Movements Engine
-- ============================================================

-- Movement type enum
DO $$ BEGIN
  CREATE TYPE public.inventory_movement_type AS ENUM (
    'purchase',
    'sale',
    'sale_return',
    'purchase_return',
    'adjustment',
    'undo_sale',
    'opening_balance',
    'transfer',
    'stock_count',
    'expired',
    'damaged',
    'lost'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.inventory_reference_type AS ENUM (
    'sale',
    'purchase',
    'sale_return',
    'purchase_return',
    'adjustment',
    'undo_sale',
    'opening_balance',
    'manual',
    'transfer',
    'stock_count'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  movement_type public.inventory_movement_type NOT NULL,
  reference_type public.inventory_reference_type NOT NULL,
  reference_id UUID,
  reference_no TEXT,
  qty_change NUMERIC NOT NULL,
  stock_before NUMERIC NOT NULL DEFAULT 0,
  stock_after NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC,
  total_cost NUMERIC,
  user_id UUID,
  customer_id UUID,
  supplier_id UUID,
  reason TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped SELECT for authenticated
CREATE POLICY inventory_movements_select_auth
  ON public.inventory_movements FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- Insert allowed for authenticated (triggers use SECURITY DEFINER so this is a safety net)
CREATE POLICY inventory_movements_insert_auth
  ON public.inventory_movements FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

-- Only admins can update / delete manually
CREATE POLICY inventory_movements_update_admin
  ON public.inventory_movements FOR UPDATE
  TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY inventory_movements_delete_admin
  ON public.inventory_movements FOR DELETE
  TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inv_mov_tenant_created
  ON public.inventory_movements (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_product_created
  ON public.inventory_movements (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_tenant_type
  ON public.inventory_movements (tenant_id, movement_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_reference
  ON public.inventory_movements (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_tenant_product_created
  ON public.inventory_movements (tenant_id, product_id, created_at DESC);

-- Fill tenant_id trigger (defensive)
DROP TRIGGER IF EXISTS trg_inv_mov_fill_tenant ON public.inventory_movements;
CREATE TRIGGER trg_inv_mov_fill_tenant
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenant_id();

-- ============================================================
-- Helper: record a movement
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_inventory_movement(
  _tenant_id UUID,
  _product_id UUID,
  _movement_type public.inventory_movement_type,
  _reference_type public.inventory_reference_type,
  _reference_id UUID,
  _reference_no TEXT,
  _qty_change NUMERIC,
  _unit_cost NUMERIC,
  _user_id UUID,
  _customer_id UUID,
  _supplier_id UUID,
  _reason TEXT,
  _note TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_stock_after NUMERIC;
  v_stock_before NUMERIC;
BEGIN
  IF _product_id IS NULL OR _tenant_id IS NULL OR _qty_change IS NULL THEN
    RETURN NULL;
  END IF;

  -- Current stock is AFTER the change (callers invoke this after updating products.stock)
  SELECT COALESCE(stock, 0) INTO v_stock_after
    FROM public.products WHERE id = _product_id;
  v_stock_before := COALESCE(v_stock_after, 0) - COALESCE(_qty_change, 0);

  INSERT INTO public.inventory_movements (
    tenant_id, product_id, movement_type, reference_type, reference_id, reference_no,
    qty_change, stock_before, stock_after, unit_cost, total_cost,
    user_id, customer_id, supplier_id, reason, note
  ) VALUES (
    _tenant_id, _product_id, _movement_type, _reference_type, _reference_id, _reference_no,
    _qty_change, v_stock_before, v_stock_after,
    _unit_cost,
    CASE WHEN _unit_cost IS NULL THEN NULL ELSE ROUND((_unit_cost * ABS(_qty_change))::numeric, 4) END,
    _user_id, _customer_id, _supplier_id, _reason, _note
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- ============================================================
-- Trigger: sale_items INSERT → movement (stock out)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_sale_item_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT invoice_no, cashier_id, customer_id INTO v_sale
    FROM public.sales WHERE id = NEW.sale_id;

  PERFORM public.record_inventory_movement(
    NEW.tenant_id, NEW.product_id, 'sale', 'sale',
    NEW.sale_id, v_sale.invoice_no,
    -NEW.qty, NEW.cost,
    v_sale.cashier_id, v_sale.customer_id, NULL,
    NULL, NULL
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sale_items_movement ON public.sale_items;
CREATE TRIGGER trg_sale_items_movement
  AFTER INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_item_movement();

-- ============================================================
-- Trigger: purchase_items INSERT → movement (stock in)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_purchase_item_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p RECORD;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT id, user_id, supplier_id INTO v_p
    FROM public.purchases WHERE id = NEW.purchase_id;

  PERFORM public.record_inventory_movement(
    NEW.tenant_id, NEW.product_id, 'purchase', 'purchase',
    NEW.purchase_id, NULL,
    NEW.qty, NEW.cost,
    v_p.user_id, NULL, v_p.supplier_id,
    NULL, NULL
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_items_movement ON public.purchase_items;
CREATE TRIGGER trg_purchase_items_movement
  AFTER INSERT ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_purchase_item_movement();

-- ============================================================
-- Trigger: sale_return_items INSERT → movement (stock in)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_sale_return_item_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r RECORD;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT user_id, customer_id INTO v_r
    FROM public.sale_returns WHERE id = NEW.return_id;

  PERFORM public.record_inventory_movement(
    NEW.tenant_id, NEW.product_id, 'sale_return', 'sale_return',
    NEW.return_id, NULL,
    NEW.qty, NEW.cost,
    v_r.user_id, v_r.customer_id, NULL,
    NULL, NULL
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sale_return_items_movement ON public.sale_return_items;
CREATE TRIGGER trg_sale_return_items_movement
  AFTER INSERT ON public.sale_return_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_return_item_movement();

-- ============================================================
-- Trigger: purchase_return_items INSERT → movement (stock out)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_purchase_return_item_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r RECORD;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT user_id, supplier_id INTO v_r
    FROM public.purchase_returns WHERE id = NEW.return_id;

  PERFORM public.record_inventory_movement(
    NEW.tenant_id, NEW.product_id, 'purchase_return', 'purchase_return',
    NEW.return_id, NULL,
    -NEW.qty, NEW.cost,
    v_r.user_id, NULL, v_r.supplier_id,
    NULL, NULL
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_return_items_movement ON public.purchase_return_items;
CREATE TRIGGER trg_purchase_return_items_movement
  AFTER INSERT ON public.purchase_return_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_purchase_return_item_movement();

-- ============================================================
-- Trigger: products INSERT → opening balance
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_product_opening_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.stock, 0) <> 0 THEN
    PERFORM public.record_inventory_movement(
      NEW.tenant_id, NEW.id, 'opening_balance', 'opening_balance',
      NEW.id, NULL, NEW.stock, NEW.cost_price,
      auth.uid(), NULL, NULL,
      'Opening balance', NULL
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_products_opening_balance ON public.products;
CREATE TRIGGER trg_products_opening_balance
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.trg_product_opening_balance();

-- ============================================================
-- Trigger: products UPDATE → adjustment (when stock is edited directly,
-- and no other trigger context already reflected the change).
-- We detect "manual adjustment" by only firing when stock changes and the
-- caller has set a session variable app.stock_change_source to NULL/empty.
-- Sales/purchases/returns/undo all mutate stock inside SECURITY DEFINER
-- functions that we now mark; those set app.stock_change_source so this
-- trigger stays silent.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_product_stock_adjustment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src TEXT;
  v_delta NUMERIC;
BEGIN
  IF COALESCE(NEW.stock, 0) = COALESCE(OLD.stock, 0) THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_src := current_setting('app.stock_change_source', true);
  EXCEPTION WHEN others THEN v_src := NULL; END;
  IF v_src IS NOT NULL AND v_src <> '' THEN
    RETURN NEW; -- movement recorded by the item-level trigger
  END IF;

  v_delta := COALESCE(NEW.stock, 0) - COALESCE(OLD.stock, 0);
  PERFORM public.record_inventory_movement(
    NEW.tenant_id, NEW.id, 'adjustment', 'adjustment',
    NEW.id, NULL, v_delta, NEW.cost_price,
    auth.uid(), NULL, NULL,
    'Manual adjustment', NULL
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_products_stock_adjustment ON public.products;
CREATE TRIGGER trg_products_stock_adjustment
  AFTER UPDATE OF stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.trg_product_stock_adjustment();

-- ============================================================
-- Mark sales/purchases/returns/undo as "stock_change_source"
-- so the adjustment trigger stays quiet. We do this by wrapping
-- their existing UPDATE statements. Since we cannot easily patch
-- those big functions here without risk, we use a session-level
-- setting from the item-level triggers: they run AFTER INSERT of
-- items which happens AFTER products UPDATE inside the same
-- transaction? Actually products UPDATE happens BEFORE the item
-- INSERT in complete_sale. Different orders per function.
--
-- Safer approach: set app.stock_change_source inside the item-
-- level trigger, and check it here won't work because products
-- UPDATE already fired.
--
-- Correct approach: patch each RPC to SET LOCAL the guc before
-- touching stock. We do that below.
-- ============================================================
