
-- ============================================================
-- Stock Count Sessions
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.stock_count_status AS ENUM ('draft','in_progress','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.stock_count_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status public.stock_count_status NOT NULL DEFAULT 'draft',
  notes TEXT,
  started_by UUID,
  approved_by UUID,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_variance_value NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_count_sessions TO authenticated;
GRANT ALL ON public.stock_count_sessions TO service_role;

ALTER TABLE public.stock_count_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY scs_select_auth ON public.stock_count_sessions
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY scs_insert_auth ON public.stock_count_sessions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());
-- Only allow updates while not completed / cancelled
CREATE POLICY scs_update_open ON public.stock_count_sessions
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND status IN ('draft','in_progress'))
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY scs_delete_admin ON public.stock_count_sessions
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(),'admin') AND status <> 'completed');

CREATE INDEX IF NOT EXISTS idx_scs_tenant_created ON public.stock_count_sessions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scs_tenant_status ON public.stock_count_sessions (tenant_id, status);

DROP TRIGGER IF EXISTS trg_scs_fill_tenant ON public.stock_count_sessions;
CREATE TRIGGER trg_scs_fill_tenant BEFORE INSERT ON public.stock_count_sessions
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenant_id();
DROP TRIGGER IF EXISTS trg_scs_updated_at ON public.stock_count_sessions;
CREATE TRIGGER trg_scs_updated_at BEFORE UPDATE ON public.stock_count_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- Stock Count Items
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stock_count_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.stock_count_sessions(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  barcode TEXT,
  system_qty NUMERIC NOT NULL DEFAULT 0,
  actual_qty NUMERIC NOT NULL DEFAULT 0,
  reason TEXT,
  counter_id UUID,
  counted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, product_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_count_items TO authenticated;
GRANT ALL ON public.stock_count_items TO service_role;

ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY sci_select_auth ON public.stock_count_items
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY sci_insert_auth ON public.stock_count_items
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.stock_count_sessions s
      WHERE s.id = session_id
        AND s.tenant_id = public.current_tenant_id()
        AND s.status IN ('draft','in_progress')
    )
  );
CREATE POLICY sci_update_open ON public.stock_count_items
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.stock_count_sessions s
      WHERE s.id = session_id AND s.status IN ('draft','in_progress')
    )
  )
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY sci_delete_open ON public.stock_count_items
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.stock_count_sessions s
      WHERE s.id = session_id AND s.status IN ('draft','in_progress')
    )
  );

CREATE INDEX IF NOT EXISTS idx_sci_session ON public.stock_count_items (session_id);
CREATE INDEX IF NOT EXISTS idx_sci_tenant_product ON public.stock_count_items (tenant_id, product_id);

DROP TRIGGER IF EXISTS trg_sci_fill_tenant ON public.stock_count_items;
CREATE TRIGGER trg_sci_fill_tenant BEFORE INSERT ON public.stock_count_items
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenant_id();
DROP TRIGGER IF EXISTS trg_sci_updated_at ON public.stock_count_items;
CREATE TRIGGER trg_sci_updated_at BEFORE UPDATE ON public.stock_count_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- Settings: scan mode
-- ============================================================
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS stock_count_scan_mode TEXT NOT NULL DEFAULT 'prompt';

-- ============================================================
-- Approve session RPC (admin only, applies adjustments)
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_stock_count_session(_session_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_session public.stock_count_sessions%ROWTYPE;
  v_item RECORD;
  v_current NUMERIC;
  v_delta NUMERIC;
  v_cost NUMERIC;
  v_total_variance NUMERIC := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF NOT public.has_role(v_uid,'admin') THEN RAISE EXCEPTION 'Only an admin can approve a stock count'; END IF;

  SELECT * INTO v_session
    FROM public.stock_count_sessions
    WHERE id = _session_id AND tenant_id = v_tenant
    FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'Stock count session not found'; END IF;
  IF v_session.status = 'completed' THEN RAISE EXCEPTION 'Session already approved'; END IF;
  IF v_session.status = 'cancelled' THEN RAISE EXCEPTION 'Session was cancelled'; END IF;

  FOR v_item IN
    SELECT * FROM public.stock_count_items
      WHERE session_id = _session_id AND tenant_id = v_tenant
  LOOP
    SELECT COALESCE(stock,0), COALESCE(cost_price,0) INTO v_current, v_cost
      FROM public.products WHERE id = v_item.product_id FOR UPDATE;
    IF v_current IS NULL THEN CONTINUE; END IF;
    v_delta := COALESCE(v_item.actual_qty,0) - v_current;
    IF v_delta = 0 THEN CONTINUE; END IF;

    UPDATE public.products
      SET stock = v_item.actual_qty, updated_at = now()
      WHERE id = v_item.product_id;

    INSERT INTO public.inventory_movements (
      tenant_id, product_id, movement_type, reference_type, reference_id, reference_no,
      qty_change, stock_before, stock_after, unit_cost, total_cost,
      user_id, reason, note
    ) VALUES (
      v_tenant, v_item.product_id, 'stock_count', 'stock_count',
      _session_id, 'SC-' || substr(_session_id::text, 1, 8),
      v_delta, v_current, v_item.actual_qty, v_cost,
      ROUND((v_cost * ABS(v_delta))::numeric, 4),
      v_uid, COALESCE(v_item.reason, 'Physical count adjustment'), NULL
    );

    v_total_variance := v_total_variance + (v_delta * v_cost);
  END LOOP;

  UPDATE public.stock_count_sessions
    SET status = 'completed',
        approved_by = v_uid,
        completed_at = now(),
        total_variance_value = v_total_variance
    WHERE id = _session_id;

  RETURN _session_id;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_stock_count_session(UUID) TO authenticated;
