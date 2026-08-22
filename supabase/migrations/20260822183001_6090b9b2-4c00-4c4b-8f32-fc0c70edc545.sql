CREATE OR REPLACE FUNCTION public.admin_shop_analytics(
  _tenant_id uuid,
  _from date DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date,
  _to date DEFAULT CURRENT_DATE
) RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_from timestamptz := _from::timestamptz;
  v_to timestamptz := (_to + 1)::timestamptz;
  v_out jsonb;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  WITH daily AS (
    SELECT date_trunc('day', created_at)::date AS day,
           COUNT(*) AS orders,
           COALESCE(SUM(total),0) AS revenue,
           COALESCE(SUM(cost_total),0) AS cost
      FROM public.sales
     WHERE tenant_id = _tenant_id AND created_at >= v_from AND created_at < v_to
     GROUP BY 1 ORDER BY 1
  ),
  top_products AS (
    SELECT si.name,
           SUM(si.qty) AS qty,
           SUM(si.line_total) AS revenue
      FROM public.sale_items si
      JOIN public.sales s ON s.id = si.sale_id
     WHERE s.tenant_id = _tenant_id AND s.created_at >= v_from AND s.created_at < v_to
     GROUP BY si.name
     ORDER BY revenue DESC
     LIMIT 10
  ),
  by_method AS (
    SELECT COALESCE(payment_method,'unknown') AS method,
           COUNT(*) AS orders,
           COALESCE(SUM(total),0) AS total
      FROM public.sales
     WHERE tenant_id = _tenant_id AND created_at >= v_from AND created_at < v_to
     GROUP BY 1 ORDER BY total DESC
  ),
  low_stock AS (
    SELECT COUNT(*) AS c FROM public.products
     WHERE tenant_id = _tenant_id AND is_active = true
       AND min_stock IS NOT NULL AND stock <= min_stock
  ),
  expenses_agg AS (
    SELECT COALESCE(SUM(amount),0) AS total FROM public.expenses
     WHERE tenant_id = _tenant_id AND created_at >= v_from AND created_at < v_to
  ),
  credit_agg AS (
    SELECT COALESCE(SUM(total - paid_amount),0) AS total FROM public.sales
     WHERE tenant_id = _tenant_id AND created_at >= v_from AND created_at < v_to
       AND payment_status IN ('unpaid', 'partial')
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', _from, 'to', _to),
    'daily', COALESCE((SELECT jsonb_agg(to_jsonb(daily.*)) FROM daily), '[]'::jsonb),
    'top_products', COALESCE((SELECT jsonb_agg(to_jsonb(top_products.*)) FROM top_products), '[]'::jsonb),
    'by_method', COALESCE((SELECT jsonb_agg(to_jsonb(by_method.*)) FROM by_method), '[]'::jsonb),
    'low_stock', (SELECT c FROM low_stock),
    'expenses_total', (SELECT total FROM expenses_agg),
    'credit_sales_total', (SELECT total FROM credit_agg)
  ) INTO v_out;

  RETURN v_out;
END $$;
