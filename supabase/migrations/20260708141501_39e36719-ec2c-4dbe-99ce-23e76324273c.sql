
-- 1. Extend store_settings with Business Operations toggles
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS ops_shift_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ops_business_day_start_hour SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ops_require_manager_approval BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ops_allow_multiple_shifts BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ops_cash_drawer_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ops_safe_drop_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ops_paid_in_out_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ops_shift_notes_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ops_pending_tasks_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ops_receipt_reprint_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.store_settings
  DROP CONSTRAINT IF EXISTS store_settings_business_day_hour_chk;
ALTER TABLE public.store_settings
  ADD CONSTRAINT store_settings_business_day_hour_chk
  CHECK (ops_business_day_start_hour BETWEEN 0 AND 6);

-- 2. shift_sessions table
CREATE TABLE IF NOT EXISTS public.shift_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  cashier_id UUID NOT NULL,
  business_date DATE NOT NULL,
  opening_cash NUMERIC(14,2) NOT NULL DEFAULT 0,
  expected_cash NUMERIC(14,2),
  actual_cash NUMERIC(14,2),
  difference NUMERIC(14,2),
  status TEXT NOT NULL DEFAULT 'open',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  close_reason TEXT,
  emergency_reason TEXT,
  opening_notes TEXT,
  closing_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shift_sessions_status_chk CHECK (status IN ('open','closed','approved','emergency_closed'))
);

CREATE INDEX IF NOT EXISTS shift_sessions_tenant_idx ON public.shift_sessions(tenant_id, business_date DESC);
CREATE INDEX IF NOT EXISTS shift_sessions_cashier_open_idx ON public.shift_sessions(tenant_id, cashier_id) WHERE status = 'open';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_sessions TO authenticated;
GRANT ALL ON public.shift_sessions TO service_role;

ALTER TABLE public.shift_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_sessions_select_own_or_admin" ON public.shift_sessions
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (cashier_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "shift_sessions_insert_own" ON public.shift_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND cashier_id = auth.uid()
  );

CREATE POLICY "shift_sessions_update_own_or_admin" ON public.shift_sessions
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (cashier_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "shift_sessions_delete_admin" ON public.shift_sessions
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_shift_sessions_touch
  BEFORE UPDATE ON public.shift_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. business_date_of() — respects tenant business-day start hour
CREATE OR REPLACE FUNCTION public.business_date_of(_ts TIMESTAMPTZ)
RETURNS DATE
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hour SMALLINT;
BEGIN
  SELECT COALESCE(ops_business_day_start_hour, 0) INTO v_hour
    FROM public.store_settings
    WHERE tenant_id = public.current_tenant_id()
    LIMIT 1;
  RETURN ((_ts AT TIME ZONE 'UTC') - make_interval(hours => COALESCE(v_hour,0)))::DATE;
END $$;

-- 4. current_shift
CREATE OR REPLACE FUNCTION public.current_shift()
RETURNS SETOF public.shift_sessions
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.shift_sessions
  WHERE tenant_id = public.current_tenant_id()
    AND cashier_id = auth.uid()
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;
$$;

-- 5. open_shift
CREATE OR REPLACE FUNCTION public.open_shift(_opening_cash NUMERIC, _notes TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_id UUID;
  v_allow_multi BOOLEAN;
  v_has_open BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF _opening_cash IS NULL OR _opening_cash < 0 THEN
    RAISE EXCEPTION 'Opening cash must be zero or positive';
  END IF;

  SELECT COALESCE(ops_allow_multiple_shifts, FALSE) INTO v_allow_multi
    FROM public.store_settings WHERE tenant_id = v_tenant LIMIT 1;

  IF NOT COALESCE(v_allow_multi, FALSE) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.shift_sessions
      WHERE tenant_id = v_tenant AND cashier_id = v_uid AND status = 'open'
    ) INTO v_has_open;
    IF v_has_open THEN
      RAISE EXCEPTION 'You already have an open shift. Close it before starting a new one.';
    END IF;
  END IF;

  INSERT INTO public.shift_sessions
    (tenant_id, cashier_id, business_date, opening_cash, opening_notes)
  VALUES
    (v_tenant, v_uid, public.business_date_of(now()), _opening_cash, _notes)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- 6. shift_report — powers X and Z reports (returns JSON)
CREATE OR REPLACE FUNCTION public.shift_report(_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID := public.current_tenant_id();
  v_shift public.shift_sessions%ROWTYPE;
  v_end TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;

  SELECT * INTO v_shift FROM public.shift_sessions
    WHERE id = _shift_id AND tenant_id = v_tenant;
  IF v_shift.id IS NULL THEN RAISE EXCEPTION 'Shift not found'; END IF;

  IF v_shift.cashier_id <> auth.uid() AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Not allowed to view this shift';
  END IF;

  v_end := COALESCE(v_shift.closed_at, now());

  WITH s AS (
    SELECT * FROM public.sales
     WHERE tenant_id = v_tenant
       AND cashier_id = v_shift.cashier_id
       AND created_at >= v_shift.opened_at
       AND created_at <= v_end
  ),
  r AS (
    SELECT * FROM public.sale_returns
     WHERE tenant_id = v_tenant
       AND user_id = v_shift.cashier_id
       AND created_at >= v_shift.opened_at
       AND created_at <= v_end
  ),
  e AS (
    SELECT * FROM public.expenses
     WHERE tenant_id = v_tenant
       AND user_id = v_shift.cashier_id
       AND created_at >= v_shift.opened_at
       AND created_at <= v_end
  ),
  sales_agg AS (
    SELECT
      COUNT(*) AS receipt_count,
      COALESCE(SUM(total),0) AS gross,
      COALESCE(SUM(discount),0) AS discount,
      COALESCE(SUM(tax),0) AS tax,
      COALESCE(SUM(cost_total),0) AS cost,
      COALESCE(SUM(CASE WHEN payment_method='cash' AND status IN ('completed','credit') THEN paid ELSE 0 END),0) AS cash_in,
      COALESCE(SUM(CASE WHEN payment_method='card' THEN paid ELSE 0 END),0) AS card_in,
      COALESCE(SUM(CASE WHEN status='credit' THEN GREATEST(total-paid,0) ELSE 0 END),0) AS credit_outstanding
    FROM s
  ),
  ret_agg AS (
    SELECT
      COUNT(*) AS return_count,
      COALESCE(SUM(total),0) AS return_total,
      COALESCE(SUM(CASE WHEN refund_method='cash' THEN refund_amount ELSE 0 END),0) AS cash_out_refund,
      COALESCE(SUM(CASE WHEN refund_method='card' THEN refund_amount ELSE 0 END),0) AS card_out_refund
    FROM r
  ),
  exp_agg AS (
    SELECT
      COUNT(*) AS expense_count,
      COALESCE(SUM(amount),0) AS expense_total,
      COALESCE(SUM(CASE WHEN method='cash' THEN amount ELSE 0 END),0) AS cash_out_expense
    FROM e
  )
  SELECT jsonb_build_object(
    'shift', jsonb_build_object(
      'id', v_shift.id,
      'cashier_id', v_shift.cashier_id,
      'business_date', v_shift.business_date,
      'opened_at', v_shift.opened_at,
      'closed_at', v_shift.closed_at,
      'status', v_shift.status,
      'opening_cash', v_shift.opening_cash,
      'actual_cash', v_shift.actual_cash,
      'expected_cash', v_shift.expected_cash,
      'difference', v_shift.difference,
      'opening_notes', v_shift.opening_notes,
      'closing_notes', v_shift.closing_notes,
      'close_reason', v_shift.close_reason,
      'emergency_reason', v_shift.emergency_reason
    ),
    'sales', to_jsonb(sales_agg.*),
    'returns', to_jsonb(ret_agg.*),
    'expenses', to_jsonb(exp_agg.*),
    'cash_summary', jsonb_build_object(
      'opening_cash', v_shift.opening_cash,
      'cash_in', sales_agg.cash_in,
      'cash_out_refund', ret_agg.cash_out_refund,
      'cash_out_expense', exp_agg.cash_out_expense,
      'expected_cash', v_shift.opening_cash + sales_agg.cash_in - ret_agg.cash_out_refund - exp_agg.cash_out_expense
    ),
    'profit', sales_agg.gross - sales_agg.tax - sales_agg.cost
  )
  INTO v_result
  FROM sales_agg, ret_agg, exp_agg;

  RETURN v_result;
END $$;

-- 7. close_shift
CREATE OR REPLACE FUNCTION public.close_shift(
  _shift_id UUID,
  _actual_cash NUMERIC,
  _closing_notes TEXT DEFAULT NULL,
  _reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID := public.current_tenant_id();
  v_uid UUID := auth.uid();
  v_shift public.shift_sessions%ROWTYPE;
  v_report JSONB;
  v_expected NUMERIC;
  v_diff NUMERIC;
  v_require_approval BOOLEAN;
  v_new_status TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF _actual_cash IS NULL OR _actual_cash < 0 THEN
    RAISE EXCEPTION 'Actual cash must be zero or positive';
  END IF;

  SELECT * INTO v_shift FROM public.shift_sessions
    WHERE id = _shift_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_shift.id IS NULL THEN RAISE EXCEPTION 'Shift not found'; END IF;
  IF v_shift.status <> 'open' THEN RAISE EXCEPTION 'Shift is not open'; END IF;
  IF v_shift.cashier_id <> v_uid AND NOT public.has_role(v_uid,'admin') THEN
    RAISE EXCEPTION 'Only the shift owner or an admin can close it';
  END IF;

  v_report := public.shift_report(_shift_id);
  v_expected := COALESCE((v_report->'cash_summary'->>'expected_cash')::NUMERIC, v_shift.opening_cash);
  v_diff := _actual_cash - v_expected;

  SELECT COALESCE(ops_require_manager_approval, FALSE) INTO v_require_approval
    FROM public.store_settings WHERE tenant_id = v_tenant LIMIT 1;

  IF v_require_approval AND NOT public.has_role(v_uid,'admin') THEN
    v_new_status := 'closed';
  ELSE
    v_new_status := CASE WHEN public.has_role(v_uid,'admin') THEN 'approved' ELSE 'closed' END;
  END IF;

  UPDATE public.shift_sessions
     SET actual_cash = _actual_cash,
         expected_cash = v_expected,
         difference = v_diff,
         closed_at = now(),
         closing_notes = _closing_notes,
         close_reason = _reason,
         status = v_new_status,
         approved_by = CASE WHEN v_new_status='approved' THEN v_uid ELSE NULL END,
         approved_at = CASE WHEN v_new_status='approved' THEN now() ELSE NULL END
   WHERE id = _shift_id;

  RETURN _shift_id;
END $$;

-- 8. approve_shift (admin)
CREATE OR REPLACE FUNCTION public.approve_shift(_shift_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID := public.current_tenant_id();
  v_uid UUID := auth.uid();
  v_shift public.shift_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(v_uid,'admin') THEN RAISE EXCEPTION 'Only an admin can approve a shift'; END IF;

  SELECT * INTO v_shift FROM public.shift_sessions
    WHERE id = _shift_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_shift.id IS NULL THEN RAISE EXCEPTION 'Shift not found'; END IF;
  IF v_shift.status <> 'closed' THEN RAISE EXCEPTION 'Only closed shifts can be approved'; END IF;

  UPDATE public.shift_sessions
     SET status = 'approved', approved_by = v_uid, approved_at = now()
   WHERE id = _shift_id;
  RETURN _shift_id;
END $$;

-- 9. emergency_close_shift
CREATE OR REPLACE FUNCTION public.emergency_close_shift(_shift_id UUID, _reason TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID := public.current_tenant_id();
  v_uid UUID := auth.uid();
  v_shift public.shift_sessions%ROWTYPE;
  v_report JSONB;
  v_expected NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'Emergency reason is required';
  END IF;

  SELECT * INTO v_shift FROM public.shift_sessions
    WHERE id = _shift_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_shift.id IS NULL THEN RAISE EXCEPTION 'Shift not found'; END IF;
  IF v_shift.status <> 'open' THEN RAISE EXCEPTION 'Shift is not open'; END IF;
  IF v_shift.cashier_id <> v_uid AND NOT public.has_role(v_uid,'admin') THEN
    RAISE EXCEPTION 'Only the shift owner or an admin can emergency-close it';
  END IF;

  v_report := public.shift_report(_shift_id);
  v_expected := COALESCE((v_report->'cash_summary'->>'expected_cash')::NUMERIC, v_shift.opening_cash);

  UPDATE public.shift_sessions
     SET status = 'emergency_closed',
         emergency_reason = _reason,
         closed_at = now(),
         expected_cash = v_expected
   WHERE id = _shift_id;
  RETURN _shift_id;
END $$;
