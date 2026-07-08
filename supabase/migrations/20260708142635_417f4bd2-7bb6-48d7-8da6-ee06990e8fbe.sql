
-- =====================================================================
-- Sprint 7A Phase 2: Extended Business Operations
-- =====================================================================

-- 1) HELD BILLS (park/resume POS carts)
CREATE TABLE IF NOT EXISTS public.held_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cashier_id UUID NOT NULL REFERENCES auth.users(id),
  shift_id UUID REFERENCES public.shift_sessions(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  label TEXT,
  payload JSONB NOT NULL,
  item_count INT NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'held', -- held | resumed | discarded
  resumed_at TIMESTAMPTZ,
  resumed_by UUID REFERENCES auth.users(id),
  discarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.held_bills TO authenticated;
GRANT ALL ON public.held_bills TO service_role;
ALTER TABLE public.held_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "held_bills tenant read" ON public.held_bills FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "held_bills tenant write" ON public.held_bills FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE INDEX IF NOT EXISTS idx_held_bills_tenant_status ON public.held_bills(tenant_id, status, created_at DESC);
CREATE TRIGGER trg_held_bills_updated BEFORE UPDATE ON public.held_bills
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) CASH DRAWER EVENTS (paid in / paid out / safe drop / float)
CREATE TABLE IF NOT EXISTS public.cash_drawer_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.shift_sessions(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  event_type TEXT NOT NULL, -- paid_in | paid_out | safe_drop | float_add | float_remove
  amount NUMERIC NOT NULL CHECK (amount > 0),
  reason TEXT,
  reference TEXT,
  approved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_drawer_events TO authenticated;
GRANT ALL ON public.cash_drawer_events TO service_role;
ALTER TABLE public.cash_drawer_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cash_events tenant read" ON public.cash_drawer_events FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "cash_events tenant write" ON public.cash_drawer_events FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE INDEX IF NOT EXISTS idx_cash_events_shift ON public.cash_drawer_events(shift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_events_tenant ON public.cash_drawer_events(tenant_id, created_at DESC);

-- 3) SHIFT NOTES
CREATE TABLE IF NOT EXISTS public.shift_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.shift_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  category TEXT DEFAULT 'general', -- general | incident | handover | customer
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_notes TO authenticated;
GRANT ALL ON public.shift_notes TO service_role;
ALTER TABLE public.shift_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shift_notes tenant" ON public.shift_notes FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE INDEX IF NOT EXISTS idx_shift_notes_shift ON public.shift_notes(shift_id, created_at DESC);

-- 4) SHIFT TASKS (pending todos, carried across shifts)
CREATE TABLE IF NOT EXISTS public.shift_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.shift_sessions(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  assigned_to UUID REFERENCES auth.users(id),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal', -- low | normal | high
  status TEXT NOT NULL DEFAULT 'open', -- open | in_progress | done | cancelled
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_tasks TO authenticated;
GRANT ALL ON public.shift_tasks TO service_role;
ALTER TABLE public.shift_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shift_tasks tenant" ON public.shift_tasks FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE INDEX IF NOT EXISTS idx_shift_tasks_status ON public.shift_tasks(tenant_id, status, created_at DESC);
CREATE TRIGGER trg_shift_tasks_updated BEFORE UPDATE ON public.shift_tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5) RECEIPT REPRINT AUDIT
CREATE TABLE IF NOT EXISTS public.receipt_reprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  shift_id UUID REFERENCES public.shift_sessions(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipt_reprints TO authenticated;
GRANT ALL ON public.receipt_reprints TO service_role;
ALTER TABLE public.receipt_reprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reprints tenant" ON public.receipt_reprints FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE INDEX IF NOT EXISTS idx_reprints_sale ON public.receipt_reprints(sale_id, created_at DESC);

-- 6) SALE VOIDS (audit of voided sales)
CREATE TABLE IF NOT EXISTS public.sale_voids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL,
  invoice_no TEXT,
  voided_by UUID NOT NULL REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  shift_id UUID REFERENCES public.shift_sessions(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  original_total NUMERIC NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_voids TO authenticated;
GRANT ALL ON public.sale_voids TO service_role;
ALTER TABLE public.sale_voids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sale_voids tenant" ON public.sale_voids FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- 7) CLOSING CHECKLIST
CREATE TABLE IF NOT EXISTS public.shift_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES public.shift_sessions(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  label TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_by UUID REFERENCES auth.users(id),
  completed_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shift_id, item_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_checklist TO authenticated;
GRANT ALL ON public.shift_checklist TO service_role;
ALTER TABLE public.shift_checklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shift_checklist tenant" ON public.shift_checklist FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- 8) MANAGER HANDOVERS
CREATE TABLE IF NOT EXISTS public.manager_handovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  from_shift_id UUID REFERENCES public.shift_sessions(id) ON DELETE SET NULL,
  to_shift_id UUID REFERENCES public.shift_sessions(id) ON DELETE SET NULL,
  from_user UUID NOT NULL REFERENCES auth.users(id),
  to_user UUID REFERENCES auth.users(id),
  cash_amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manager_handovers TO authenticated;
GRANT ALL ON public.manager_handovers TO service_role;
ALTER TABLE public.manager_handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "handovers tenant" ON public.manager_handovers FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- Extend store_settings with Phase 2 toggles
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS ops_hold_bills_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ops_paid_in_out_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ops_safe_drop_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ops_safe_drop_threshold NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ops_reprint_audit_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ops_void_requires_reason BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ops_checklist_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ops_checklist_items JSONB NOT NULL DEFAULT '["Cash counted","Safe drop done","Cleaning done","Doors locked"]'::jsonb;

-- ============================
-- RPCs
-- ============================

-- Hold bill
CREATE OR REPLACE FUNCTION public.hold_bill(_label TEXT, _customer UUID, _payload JSONB, _item_count INT, _total NUMERIC)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_shift UUID;
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  SELECT id INTO v_shift FROM public.shift_sessions
    WHERE tenant_id = v_tenant AND cashier_id = v_uid AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  INSERT INTO public.held_bills (tenant_id, cashier_id, shift_id, customer_id, label, payload, item_count, total)
  VALUES (v_tenant, v_uid, v_shift, _customer, _label, _payload, COALESCE(_item_count,0), COALESCE(_total,0))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Resume bill
CREATE OR REPLACE FUNCTION public.resume_bill(_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_row public.held_bills%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_row FROM public.held_bills
    WHERE id = _id AND tenant_id = v_tenant AND status = 'held' FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Held bill not found'; END IF;
  UPDATE public.held_bills SET status='resumed', resumed_at=now(), resumed_by=v_uid WHERE id=_id;
  RETURN v_row.payload;
END $$;

-- Discard bill
CREATE OR REPLACE FUNCTION public.discard_held_bill(_id UUID, _reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_tenant UUID := public.current_tenant_id();
BEGIN
  UPDATE public.held_bills
     SET status='discarded', discarded_at=now()
   WHERE id=_id AND tenant_id=v_tenant AND status='held';
END $$;

-- Cash drawer event
CREATE OR REPLACE FUNCTION public.record_cash_event(_type TEXT, _amount NUMERIC, _reason TEXT, _reference TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_shift UUID;
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _type NOT IN ('paid_in','paid_out','safe_drop','float_add','float_remove') THEN
    RAISE EXCEPTION 'Invalid event type';
  END IF;
  SELECT id INTO v_shift FROM public.shift_sessions
    WHERE tenant_id = v_tenant AND cashier_id = v_uid AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  INSERT INTO public.cash_drawer_events (tenant_id, shift_id, user_id, event_type, amount, reason, reference)
  VALUES (v_tenant, v_shift, v_uid, _type, _amount, _reason, _reference)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Log reprint
CREATE OR REPLACE FUNCTION public.log_receipt_reprint(_sale_id UUID, _reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_shift UUID;
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_shift FROM public.shift_sessions
    WHERE tenant_id = v_tenant AND cashier_id = v_uid AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  INSERT INTO public.receipt_reprints (tenant_id, sale_id, user_id, shift_id, reason)
  VALUES (v_tenant, _sale_id, v_uid, v_shift, _reason)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Void sale (like undo but with audit + reason, admin only)
CREATE OR REPLACE FUNCTION public.void_sale(_sale_id UUID, _reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_sale public.sales%ROWTYPE;
  v_payload JSONB;
  v_shift UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF NOT public.has_role(v_uid,'admin') THEN RAISE EXCEPTION 'Only an admin can void a sale'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN RAISE EXCEPTION 'Reason is required'; END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id=_sale_id AND tenant_id=v_tenant FOR UPDATE;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;

  SELECT jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(si)) FROM public.sale_items si WHERE si.sale_id = _sale_id), '[]'::jsonb)
  ) INTO v_payload;

  SELECT id INTO v_shift FROM public.shift_sessions
    WHERE tenant_id = v_tenant AND cashier_id = v_uid AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;

  INSERT INTO public.sale_voids (tenant_id, sale_id, invoice_no, voided_by, shift_id, reason, original_total, payload)
  VALUES (v_tenant, v_sale.id, v_sale.invoice_no, v_uid, v_shift, _reason, v_sale.total, v_payload);

  -- Restore stock
  UPDATE public.products p SET stock = COALESCE(p.stock,0) + si.qty, updated_at=now()
    FROM public.sale_items si
   WHERE si.sale_id = _sale_id AND si.product_id = p.id;

  -- Reverse credit
  IF v_sale.status='credit' AND v_sale.customer_id IS NOT NULL AND (v_sale.total - v_sale.paid) > 0 THEN
    UPDATE public.customers SET balance = balance - (v_sale.total - v_sale.paid) WHERE id = v_sale.customer_id;
  END IF;

  -- Reverse staff expense
  IF v_sale.expense_person_id IS NOT NULL THEN
    DELETE FROM public.expenses WHERE sale_id = _sale_id;
  END IF;

  DELETE FROM public.sale_items WHERE sale_id = _sale_id;
  DELETE FROM public.sales WHERE id = _sale_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, old_data, new_data)
  VALUES (v_tenant, v_uid, 'VOID_SALE', 'sales', _sale_id, v_payload, jsonb_build_object('reason',_reason));

  RETURN v_payload;
END $$;

-- Seed / upsert checklist item
CREATE OR REPLACE FUNCTION public.set_checklist_item(_shift_id UUID, _key TEXT, _label TEXT, _completed BOOLEAN, _note TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.shift_checklist (tenant_id, shift_id, item_key, label, completed, completed_by, completed_at, note)
  VALUES (v_tenant, _shift_id, _key, _label, COALESCE(_completed,FALSE),
          CASE WHEN _completed THEN v_uid ELSE NULL END,
          CASE WHEN _completed THEN now() ELSE NULL END,
          _note)
  ON CONFLICT (shift_id, item_key) DO UPDATE
    SET completed = EXCLUDED.completed,
        completed_by = CASE WHEN EXCLUDED.completed THEN v_uid ELSE NULL END,
        completed_at = CASE WHEN EXCLUDED.completed THEN now() ELSE NULL END,
        note = EXCLUDED.note,
        label = EXCLUDED.label
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Morning dashboard (aggregate yesterday)
CREATE OR REPLACE FUNCTION public.morning_dashboard()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_tenant UUID := public.current_tenant_id();
  v_start TIMESTAMPTZ := (CURRENT_DATE - 1);
  v_end   TIMESTAMPTZ := CURRENT_DATE;
  v_result JSONB;
BEGIN
  IF v_tenant IS NULL THEN RETURN '{}'::jsonb; END IF;
  WITH s AS (
    SELECT COUNT(*) c, COALESCE(SUM(total),0) t, COALESCE(SUM(cost_total),0) cost
    FROM public.sales WHERE tenant_id=v_tenant AND created_at >= v_start AND created_at < v_end
  ),
  r AS (
    SELECT COUNT(*) c, COALESCE(SUM(total),0) t
    FROM public.sale_returns WHERE tenant_id=v_tenant AND created_at >= v_start AND created_at < v_end
  ),
  e AS (
    SELECT COALESCE(SUM(amount),0) t FROM public.expenses
    WHERE tenant_id=v_tenant AND created_at >= v_start AND created_at < v_end
  ),
  h AS (
    SELECT COUNT(*) c FROM public.held_bills WHERE tenant_id=v_tenant AND status='held'
  ),
  tk AS (
    SELECT COUNT(*) c FROM public.shift_tasks WHERE tenant_id=v_tenant AND status IN ('open','in_progress')
  ),
  lo AS (
    SELECT COUNT(*) c FROM public.products WHERE tenant_id=v_tenant AND is_active=true
      AND min_stock IS NOT NULL AND stock <= min_stock
  )
  SELECT jsonb_build_object(
    'yesterday_sales_count', s.c, 'yesterday_sales_total', s.t, 'yesterday_profit', s.t - s.cost,
    'yesterday_returns', r.c, 'yesterday_returns_total', r.t,
    'yesterday_expenses', e.t,
    'held_bills', h.c,
    'open_tasks', tk.c,
    'low_stock_products', lo.c
  ) INTO v_result FROM s,r,e,h,tk,lo;
  RETURN v_result;
END $$;
