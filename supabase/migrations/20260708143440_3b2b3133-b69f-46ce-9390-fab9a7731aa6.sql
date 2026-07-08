
-- Targets in store_settings
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS ops_target_sales NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ops_target_profit NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ops_target_invoices INT NOT NULL DEFAULT 0;

-- ============================
-- daily_timeline: chronological activity feed for a date
-- ============================
CREATE OR REPLACE FUNCTION public.daily_timeline(_date DATE)
RETURNS TABLE (
  ts TIMESTAMPTZ,
  kind TEXT,
  title TEXT,
  detail TEXT,
  amount NUMERIC,
  user_id UUID,
  ref_id UUID
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_tenant UUID := public.current_tenant_id();
  v_start TIMESTAMPTZ := _date::timestamptz;
  v_end   TIMESTAMPTZ := (_date + 1)::timestamptz;
BEGIN
  IF v_tenant IS NULL THEN RETURN; END IF;
  RETURN QUERY
    -- Shift open/close
    SELECT s.opened_at, 'shift_open', 'Shift opened',
           COALESCE(s.opening_notes,''), s.opening_cash, s.cashier_id, s.id
      FROM public.shift_sessions s
     WHERE s.tenant_id = v_tenant AND s.opened_at >= v_start AND s.opened_at < v_end
    UNION ALL
    SELECT s.closed_at, 'shift_close', 'Shift closed',
           COALESCE(s.closing_notes,''), s.actual_cash, s.cashier_id, s.id
      FROM public.shift_sessions s
     WHERE s.tenant_id = v_tenant AND s.closed_at IS NOT NULL
       AND s.closed_at >= v_start AND s.closed_at < v_end
    UNION ALL
    -- Sales
    SELECT sa.created_at, 'sale', COALESCE('Invoice ' || sa.invoice_no, 'Sale'),
           sa.payment_method, sa.total, sa.cashier_id, sa.id
      FROM public.sales sa
     WHERE sa.tenant_id = v_tenant AND sa.created_at >= v_start AND sa.created_at < v_end
    UNION ALL
    -- Sale returns
    SELECT r.created_at, 'sale_return', 'Sale return',
           COALESCE(r.note,''), r.total, r.user_id, r.id
      FROM public.sale_returns r
     WHERE r.tenant_id = v_tenant AND r.created_at >= v_start AND r.created_at < v_end
    UNION ALL
    -- Purchases
    SELECT p.created_at, 'purchase', 'Purchase',
           COALESCE(p.note,''), p.total, p.user_id, p.id
      FROM public.purchases p
     WHERE p.tenant_id = v_tenant AND p.created_at >= v_start AND p.created_at < v_end
    UNION ALL
    -- Expenses
    SELECT e.created_at, 'expense', COALESCE('Expense: ' || e.category, 'Expense'),
           COALESCE(e.description,''), e.amount, e.user_id, e.id
      FROM public.expenses e
     WHERE e.tenant_id = v_tenant AND e.created_at >= v_start AND e.created_at < v_end
    UNION ALL
    -- Cash drawer events
    SELECT c.created_at, 'cash_' || c.event_type, initcap(replace(c.event_type,'_',' ')),
           COALESCE(c.reason,''), c.amount, c.user_id, c.id
      FROM public.cash_drawer_events c
     WHERE c.tenant_id = v_tenant AND c.created_at >= v_start AND c.created_at < v_end
    UNION ALL
    -- Voids
    SELECT v.created_at, 'void', 'Void: ' || COALESCE(v.invoice_no, ''),
           v.reason, v.original_total, v.voided_by, v.id
      FROM public.sale_voids v
     WHERE v.tenant_id = v_tenant AND v.created_at >= v_start AND v.created_at < v_end
    UNION ALL
    -- Reprints
    SELECT rp.created_at, 'reprint', 'Receipt reprint',
           COALESCE(rp.reason,''), NULL::numeric, rp.user_id, rp.id
      FROM public.receipt_reprints rp
     WHERE rp.tenant_id = v_tenant AND rp.created_at >= v_start AND rp.created_at < v_end
    UNION ALL
    -- Notes
    SELECT n.created_at, 'note', 'Shift note (' || n.category || ')',
           n.note, NULL::numeric, n.user_id, n.id
      FROM public.shift_notes n
     WHERE n.tenant_id = v_tenant AND n.created_at >= v_start AND n.created_at < v_end
    ORDER BY ts DESC;
END $$;

-- ============================
-- daily_summary: aggregate stats for one date
-- ============================
CREATE OR REPLACE FUNCTION public.daily_summary(_date DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_tenant UUID := public.current_tenant_id();
  v_start TIMESTAMPTZ := _date::timestamptz;
  v_end   TIMESTAMPTZ := (_date + 1)::timestamptz;
  v JSONB;
BEGIN
  IF v_tenant IS NULL THEN RETURN '{}'::jsonb; END IF;
  WITH s AS (
    SELECT COUNT(*) c, COALESCE(SUM(total),0) t, COALESCE(SUM(cost_total),0) cost,
           COALESCE(SUM(discount),0) discount
      FROM public.sales WHERE tenant_id=v_tenant AND created_at>=v_start AND created_at<v_end
  ),
  r AS (
    SELECT COUNT(*) c, COALESCE(SUM(total),0) t
      FROM public.sale_returns WHERE tenant_id=v_tenant AND created_at>=v_start AND created_at<v_end
  ),
  p AS (
    SELECT COUNT(*) c, COALESCE(SUM(total),0) t
      FROM public.purchases WHERE tenant_id=v_tenant AND created_at>=v_start AND created_at<v_end
  ),
  e AS (
    SELECT COUNT(*) c, COALESCE(SUM(amount),0) t
      FROM public.expenses WHERE tenant_id=v_tenant AND created_at>=v_start AND created_at<v_end
  ),
  sh AS (
    SELECT COUNT(*) c, COALESCE(SUM(difference),0) diff
      FROM public.shift_sessions WHERE tenant_id=v_tenant AND business_date=_date
  ),
  nt AS (
    SELECT COUNT(*) c FROM public.shift_notes
      WHERE tenant_id=v_tenant AND created_at>=v_start AND created_at<v_end
  ),
  tk AS (
    SELECT COUNT(*) c FROM public.shift_tasks
      WHERE tenant_id=v_tenant AND created_at>=v_start AND created_at<v_end
  )
  SELECT jsonb_build_object(
    'date', _date,
    'sales_count', s.c, 'sales_total', s.t, 'sales_discount', s.discount,
    'profit', s.t - s.cost,
    'returns_count', r.c, 'returns_total', r.t,
    'purchases_count', p.c, 'purchases_total', p.t,
    'expenses_count', e.c, 'expenses_total', e.t,
    'shifts_count', sh.c, 'cash_difference', sh.diff,
    'notes_count', nt.c, 'tasks_count', tk.c
  ) INTO v FROM s,r,p,e,sh,nt,tk;
  RETURN v;
END $$;

-- ============================
-- owner_alerts: rule-based alerts
-- ============================
CREATE OR REPLACE FUNCTION public.owner_alerts()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_tenant UUID := public.current_tenant_id();
  v_thr NUMERIC;
  v_expire_days INT;
  v_result JSONB;
BEGIN
  IF v_tenant IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(low_stock_threshold, 5), COALESCE(expiring_soon_days, 30)
    INTO v_thr, v_expire_days
    FROM public.store_settings WHERE tenant_id = v_tenant LIMIT 1;

  WITH lo AS (
    SELECT COUNT(*) c FROM public.products
     WHERE tenant_id=v_tenant AND is_active=true
       AND stock <= COALESCE(min_stock, v_thr)
  ),
  ex_soon AS (
    SELECT COUNT(*) c FROM public.product_batches
     WHERE tenant_id=v_tenant AND qty_remaining>0 AND status='active'
       AND expiry_date IS NOT NULL
       AND expiry_date <= (CURRENT_DATE + v_expire_days)
       AND expiry_date >= CURRENT_DATE
  ),
  ex_dead AS (
    SELECT COUNT(*) c FROM public.product_batches
     WHERE tenant_id=v_tenant AND qty_remaining>0 AND status='active'
       AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE
  ),
  sc AS (
    SELECT COUNT(*) c FROM public.stock_count_sessions
     WHERE tenant_id=v_tenant AND status IN ('draft','in_progress')
  ),
  cash AS (
    SELECT COUNT(*) c, COALESCE(SUM(ABS(difference)),0) v FROM public.shift_sessions
     WHERE tenant_id=v_tenant AND status='closed' AND ABS(COALESCE(difference,0)) > 0
  ),
  waste AS (
    SELECT COALESCE(SUM(total_value),0) v FROM public.inventory_waste
     WHERE tenant_id=v_tenant AND created_at >= (CURRENT_DATE - 7)
  ),
  supp AS (
    SELECT COUNT(*) c, COALESCE(SUM(balance),0) v FROM public.suppliers
     WHERE tenant_id=v_tenant AND balance > 0
  )
  SELECT jsonb_build_array(
    jsonb_build_object('key','low_stock','severity',CASE WHEN lo.c>0 THEN 'warn' ELSE 'ok' END,
      'title','Low stock','count',lo.c,'route','/products?filter=low'),
    jsonb_build_object('key','near_expiry','severity',CASE WHEN ex_soon.c>0 THEN 'warn' ELSE 'ok' END,
      'title','Near-expiry batches','count',ex_soon.c,'route','/expiry'),
    jsonb_build_object('key','expired','severity',CASE WHEN ex_dead.c>0 THEN 'danger' ELSE 'ok' END,
      'title','Expired batches','count',ex_dead.c,'route','/expiry'),
    jsonb_build_object('key','pending_stock_count','severity',CASE WHEN sc.c>0 THEN 'info' ELSE 'ok' END,
      'title','Pending stock counts','count',sc.c,'route','/stock-count'),
    jsonb_build_object('key','cash_difference','severity',CASE WHEN cash.c>0 THEN 'warn' ELSE 'ok' END,
      'title','Shifts with cash difference','count',cash.c,'amount',cash.v,'route','/shifts'),
    jsonb_build_object('key','waste_week','severity',CASE WHEN waste.v>0 THEN 'info' ELSE 'ok' END,
      'title','Waste value (7d)','amount',waste.v,'route','/expiry'),
    jsonb_build_object('key','supplier_dues','severity',CASE WHEN supp.c>0 THEN 'info' ELSE 'ok' END,
      'title','Suppliers with balance','count',supp.c,'amount',supp.v,'route','/suppliers')
  ) INTO v_result FROM lo, ex_soon, ex_dead, sc, cash, waste, supp;
  RETURN v_result;
END $$;

-- ============================
-- owner_recommendations: rule-based actions
-- ============================
CREATE OR REPLACE FUNCTION public.owner_recommendations()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_tenant UUID := public.current_tenant_id();
  v_result JSONB;
BEGIN
  IF v_tenant IS NULL THEN RETURN '[]'::jsonb; END IF;
  WITH low AS (
    SELECT name, stock, min_stock FROM public.products
     WHERE tenant_id=v_tenant AND is_active=true AND min_stock IS NOT NULL AND stock <= min_stock
     ORDER BY (min_stock - stock) DESC LIMIT 5
  ),
  exp_products AS (
    SELECT p.name, MIN(b.expiry_date) e FROM public.product_batches b
     JOIN public.products p ON p.id=b.product_id
     WHERE b.tenant_id=v_tenant AND b.qty_remaining>0 AND b.status='active'
       AND b.expiry_date IS NOT NULL AND b.expiry_date < CURRENT_DATE + 7
     GROUP BY p.name ORDER BY e ASC LIMIT 5
  ),
  supp AS (
    SELECT name, balance FROM public.suppliers
     WHERE tenant_id=v_tenant AND balance > 0 ORDER BY balance DESC LIMIT 5
  ),
  sc AS (
    SELECT id, session_name, created_at FROM public.stock_count_sessions
     WHERE tenant_id=v_tenant AND status IN ('draft','in_progress')
     ORDER BY created_at DESC LIMIT 3
  ),
  cash AS (
    SELECT id, business_date, difference FROM public.shift_sessions
     WHERE tenant_id=v_tenant AND status='closed' AND ABS(COALESCE(difference,0)) > 0
     ORDER BY closed_at DESC LIMIT 3
  )
  SELECT jsonb_build_object(
    'reorder', COALESCE((SELECT jsonb_agg(jsonb_build_object('title','Reorder '||name,'detail','Stock '||stock||' / min '||min_stock,'priority','high')) FROM low), '[]'::jsonb),
    'expiry', COALESCE((SELECT jsonb_agg(jsonb_build_object('title','Check expiry: '||name,'detail','Expires '||e,'priority','high')) FROM exp_products), '[]'::jsonb),
    'suppliers', COALESCE((SELECT jsonb_agg(jsonb_build_object('title','Pay supplier: '||name,'detail','Balance due','amount',balance,'priority','normal')) FROM supp), '[]'::jsonb),
    'stock_counts', COALESCE((SELECT jsonb_agg(jsonb_build_object('title','Complete stock count','detail',COALESCE(session_name,'Untitled'),'priority','normal','id',id)) FROM sc), '[]'::jsonb),
    'cash_diff', COALESCE((SELECT jsonb_agg(jsonb_build_object('title','Review cash difference','detail',business_date||': '||difference,'priority','normal','id',id)) FROM cash), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END $$;
