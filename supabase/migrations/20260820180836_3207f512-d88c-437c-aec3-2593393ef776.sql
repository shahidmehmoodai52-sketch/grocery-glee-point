-- performance_optimizations_dashboard_reports_cashflow.sql

-- 1. Helper to resolve payment method to a bucket name (used in Views)
CREATE OR REPLACE FUNCTION public.resolve_payment_bucket(p_method text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_m text := lower(trim(COALESCE(p_method, 'cash')));
BEGIN
  IF v_m = '' OR v_m = 'cash' THEN RETURN 'cash'; END IF;
  IF v_m LIKE '%card%' THEN RETURN 'card'; END IF;
  IF v_m LIKE '%bank%' OR v_m LIKE '%online%' OR v_m LIKE '%transfer%' OR v_m LIKE '%cheque%' OR v_m LIKE '%check%' THEN RETURN 'bank'; END IF;
  IF v_m LIKE '%easy%' OR v_m LIKE '%jazz%' OR v_m LIKE '%wallet%' OR v_m LIKE '%upi%' OR v_m LIKE '%mobile%' THEN RETURN 'mobile_wallet'; END IF;
  RETURN 'other';
END $$;

-- 2. Dashboard Timeseries RPC
CREATE OR REPLACE FUNCTION public.get_dashboard_timeseries(p_from_date timestamptz, p_to_date timestamptz)
RETURNS TABLE (
  bucket_date text,
  revenue numeric,
  profit numeric,
  returns numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_span_days int;
BEGIN
  IF v_tenant_id IS NULL THEN RETURN; END IF;
  
  v_span_days := extract(day from (p_to_date - p_from_date))::int;
  
  IF v_span_days <= 1 THEN
    -- Hourly buckets
    RETURN QUERY
    WITH hours AS (
      SELECT generate_series(0, 23) as h
    ),
    s_agg AS (
      SELECT 
        extract(hour from created_at) as h,
        sum(total) as rev,
        sum(total - tax - cost_total) as prof
      FROM sales
      WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date AND status != 'voided'
      GROUP BY 1
    ),
    r_agg AS (
      SELECT 
        extract(hour from created_at) as h,
        sum(total) as ret
      FROM sale_returns
      WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date
      GROUP BY 1
    )
    SELECT 
      lpad(hours.h::text, 2, '0') || ':00',
      COALESCE(s_agg.rev, 0)::numeric,
      COALESCE(s_agg.prof, 0)::numeric,
      COALESCE(r_agg.ret, 0)::numeric
    FROM hours
    LEFT JOIN s_agg ON s_agg.h = hours.h
    LEFT JOIN r_agg ON r_agg.h = hours.h
    ORDER BY hours.h;
  ELSE
    -- Daily buckets
    RETURN QUERY
    WITH days AS (
      SELECT generate_series(p_from_date::date, p_to_date::date, '1 day'::interval)::date as d
    ),
    s_agg AS (
      SELECT 
        created_at::date as d,
        sum(total) as rev,
        sum(total - tax - cost_total) as prof
      FROM sales
      WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date AND status != 'voided'
      GROUP BY 1
    ),
    r_agg AS (
      SELECT 
        created_at::date as d,
        sum(total) as ret
      FROM sale_returns
      WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date
      GROUP BY 1
    )
    SELECT 
      to_char(days.d, 'MM-DD'),
      COALESCE(s_agg.rev, 0)::numeric,
      COALESCE(s_agg.prof, 0)::numeric,
      COALESCE(r_agg.ret, 0)::numeric
    FROM days
    LEFT JOIN s_agg ON s_agg.d = days.d
    LEFT JOIN r_agg ON r_agg.d = days.d
    ORDER BY days.d;
  END IF;
END $$;

-- 3. Top Selling Items RPC
CREATE OR REPLACE FUNCTION public.get_top_selling_items(p_from_date timestamptz, p_to_date timestamptz, p_limit int DEFAULT 6)
RETURNS TABLE (
  name text,
  qty numeric,
  total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
BEGIN
  RETURN QUERY
  SELECT 
    si.name,
    sum(si.qty) as total_qty,
    sum(si.line_total) as total_revenue
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  WHERE s.tenant_id = v_tenant_id 
    AND s.created_at >= p_from_date 
    AND s.created_at <= p_to_date
    AND s.status != 'voided'
  GROUP BY si.name
  ORDER BY total_revenue DESC
  LIMIT p_limit;
END $$;

-- 4. Low Stock Products RPC
CREATE OR REPLACE FUNCTION public.get_low_stock_products(p_threshold numeric DEFAULT 5, p_limit int DEFAULT 6)
RETURNS TABLE (
  id uuid,
  name text,
  stock numeric,
  sell_price numeric,
  cost_price numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
BEGIN
  RETURN QUERY
  SELECT 
    p.id, p.name, p.stock, p.sell_price, p.cost_price
  FROM products p
  WHERE p.tenant_id = v_tenant_id 
    AND p.is_active = true 
    AND p.stock <= p_threshold
  ORDER BY p.stock ASC
  LIMIT p_limit;
END $$;

-- 5. Inventory Value RPC
CREATE OR REPLACE FUNCTION public.get_inventory_value()
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_total numeric;
BEGIN
  SELECT sum(stock * cost_price) INTO v_total
  FROM products
  WHERE tenant_id = v_tenant_id AND is_active = true;
  RETURN COALESCE(v_total, 0);
END $$;

-- 6. Reports Summary RPC
CREATE OR REPLACE FUNCTION public.get_reports_summary(p_from_date timestamptz, p_to_date timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_sales_total numeric;
  v_sales_cost numeric;
  v_sales_tax numeric;
  v_sales_count int;
  v_returns_total numeric;
  v_returns_count int;
  v_purchases_total numeric;
  v_expenses_total numeric;
  v_party_payments_in numeric;
  v_party_payments_out numeric;
BEGIN
  IF v_tenant_id IS NULL THEN RETURN NULL; END IF;

  SELECT 
    COALESCE(sum(total), 0), 
    COALESCE(sum(cost_total), 0), 
    COALESCE(sum(tax), 0),
    count(*)::int
  INTO v_sales_total, v_sales_cost, v_sales_tax, v_sales_count
  FROM sales 
  WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date AND status != 'voided';

  SELECT 
    COALESCE(sum(total), 0),
    count(*)::int
  INTO v_returns_total, v_returns_count
  FROM sale_returns 
  WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date;

  SELECT COALESCE(sum(total), 0) INTO v_purchases_total
  FROM purchases 
  WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date;

  SELECT COALESCE(sum(amount), 0) INTO v_expenses_total
  FROM expenses 
  WHERE tenant_id = v_tenant_id AND expense_date >= p_from_date::date AND expense_date <= p_to_date::date;

  SELECT 
    COALESCE(sum(CASE WHEN party_type = 'customer' THEN amount ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN party_type = 'supplier' THEN amount ELSE 0 END), 0)
  INTO v_party_payments_in, v_party_payments_out
  FROM party_payments 
  WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date;

  RETURN jsonb_build_object(
    'sales_total', v_sales_total,
    'sales_cost', v_sales_cost,
    'sales_tax', v_sales_tax,
    'sales_count', v_sales_count,
    'returns_total', v_returns_total,
    'returns_count', v_returns_count,
    'purchases_total', v_purchases_total,
    'expenses_total', v_expenses_total,
    'party_payments_in', v_party_payments_in,
    'party_payments_out', v_party_payments_out
  );
END $$;

-- 7. Unified Cash Flow View/RPC Helper
CREATE OR REPLACE FUNCTION public.get_cash_flow_ledger(
  p_from_date timestamptz DEFAULT NULL,
  p_to_date timestamptz DEFAULT NULL,
  p_account_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_offset int DEFAULT 0,
  p_limit int DEFAULT 1000
)
RETURNS TABLE (
  id text,
  occurred_on date,
  created_at timestamptz,
  direction text,
  amount numeric,
  category text,
  reference text,
  notes text,
  account_id uuid,
  account_name text,
  payment_method text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
BEGIN
  RETURN QUERY
  WITH raw_entries AS (
    -- 1. Explicit Cash Transactions
    SELECT 
      ct.id::text,
      ct.occurred_on,
      ct.created_at,
      ct.direction,
      ct.amount,
      ct.category,
      ct.reference,
      ct.notes,
      ct.account_id,
      ca.name as account_name,
      ct.payment_method
    FROM cash_transactions ct
    LEFT JOIN cash_accounts ca ON ca.id = ct.account_id
    WHERE ct.tenant_id = v_tenant_id
    
    UNION ALL
    
    -- 2. Sales (Paid portion)
    SELECT 
      'sale:' || s.id,
      s.created_at::date,
      s.created_at,
      'in' as direction,
      s.paid as amount,
      'sale' as category,
      s.invoice_no as reference,
      c.name as notes,
      (SELECT ca2.id FROM cash_accounts ca2 
       WHERE ca2.tenant_id = v_tenant_id 
       AND ca2.type = public.resolve_payment_bucket(s.payment_method) 
       AND ca2.is_active LIMIT 1) as account_id,
      s.payment_method as account_name,
      s.payment_method
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.tenant_id = v_tenant_id AND s.paid > 0 AND s.status != 'voided' AND s.expense_person_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM cash_transactions ct2 WHERE ct2.reference = s.invoice_no)

    UNION ALL
    
    -- 3. Sale Returns
    SELECT 
      'sret:' || sr.id,
      sr.created_at::date,
      sr.created_at,
      'out' as direction,
      sr.refund_amount as amount,
      'sale_return' as category,
      sr.return_no as reference,
      c.name as notes,
      (SELECT ca2.id FROM cash_accounts ca2 
       WHERE ca2.tenant_id = v_tenant_id 
       AND ca2.type = public.resolve_payment_bucket(sr.refund_method) 
       AND ca2.is_active LIMIT 1) as account_id,
      sr.refund_method as account_name,
      sr.refund_method as payment_method
    FROM sale_returns sr
    LEFT JOIN customers c ON c.id = sr.customer_id
    WHERE sr.tenant_id = v_tenant_id AND sr.refund_amount > 0
    AND NOT EXISTS (SELECT 1 FROM cash_transactions ct2 WHERE ct2.reference = sr.return_no)
    
    UNION ALL
    
    -- 4. Purchases
    SELECT 
      'pur:' || p.id,
      p.created_at::date,
      p.created_at,
      'out' as direction,
      p.paid as amount,
      'purchase' as category,
      p.invoice_no as reference,
      sup.name as notes,
      COALESCE(p.account_id, (SELECT ca2.id FROM cash_accounts ca2 
       WHERE ca2.tenant_id = v_tenant_id 
       AND ca2.type = public.resolve_payment_bucket(p.payment_method) 
       AND ca2.is_active LIMIT 1)) as account_id,
      p.payment_method as account_name,
      p.payment_method
    FROM purchases p
    LEFT JOIN suppliers sup ON sup.id = p.supplier_id
    WHERE p.tenant_id = v_tenant_id AND p.paid > 0
    AND NOT EXISTS (SELECT 1 FROM cash_transactions ct2 WHERE ct2.reference = p.invoice_no)

    UNION ALL
    
    -- 5. Expenses
    SELECT 
      'exp:' || e.id,
      e.expense_date,
      e.created_at,
      'out' as direction,
      e.amount,
      'expense' as category,
      e.category as reference,
      e.description as notes,
      (SELECT ca2.id FROM cash_accounts ca2 
       WHERE ca2.tenant_id = v_tenant_id 
       AND ca2.type = public.resolve_payment_bucket(e.method) 
       AND ca2.is_active LIMIT 1) as account_id,
      e.method as account_name,
      e.method as payment_method
    FROM expenses e
    WHERE e.tenant_id = v_tenant_id
    AND NOT EXISTS (SELECT 1 FROM cash_transactions ct2 WHERE ct2.category = 'expense' AND ct2.amount = e.amount AND abs(extract(epoch from (ct2.created_at - e.created_at))) < 2)
  )
  SELECT * FROM raw_entries
  WHERE (p_from_date IS NULL OR created_at >= p_from_date)
    AND (p_to_date IS NULL OR created_at <= p_to_date)
    AND (p_account_id IS NULL OR account_id = p_account_id)
    AND (p_search IS NULL OR reference ILIKE '%' || p_search || '%' OR notes ILIKE '%' || p_search || '%')
  ORDER BY created_at DESC
  OFFSET p_offset
  LIMIT p_limit;
END $$;

-- 8. Cash Flow Summary RPC
CREATE OR REPLACE FUNCTION public.get_cash_flow_summary(p_from_date timestamptz DEFAULT NULL, p_to_date timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_opening numeric;
  v_total_in numeric;
  v_total_out numeric;
  v_receivables numeric;
  v_payables numeric;
BEGIN
  -- Opening = Sum of all account opening balances
  SELECT sum(opening_balance) INTO v_opening
  FROM cash_accounts
  WHERE tenant_id = v_tenant_id;

  -- Totals from ledger (we call the RPC logic but aggregate)
  SELECT 
    sum(CASE WHEN direction = 'in' THEN amount ELSE 0 END),
    sum(CASE WHEN direction = 'out' THEN amount ELSE 0 END)
  INTO v_total_in, v_total_out
  FROM public.get_cash_flow_ledger(p_from_date, p_to_date, NULL, NULL, 0, 1000000);

  -- Receivables = total customer balance
  SELECT sum(balance) INTO v_receivables
  FROM customers
  WHERE tenant_id = v_tenant_id;

  -- Payables = total supplier balance
  SELECT sum(balance) INTO v_payables
  FROM suppliers
  WHERE tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'opening', COALESCE(v_opening, 0),
    'total_in', COALESCE(v_total_in, 0),
    'total_out', COALESCE(v_total_out, 0),
    'balance', COALESCE(v_opening, 0) + COALESCE(v_total_in, 0) - COALESCE(v_total_out, 0),
    'receivables', COALESCE(v_receivables, 0),
    'payables', COALESCE(v_payables, 0)
  );
END $$;

-- Grants
GRANT EXECUTE ON FUNCTION public.get_dashboard_timeseries(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_selling_items(timestamptz, timestamptz, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_low_stock_products(numeric, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_value() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reports_summary(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_flow_ledger(timestamptz, timestamptz, uuid, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_flow_summary(timestamptz, timestamptz) TO authenticated;
