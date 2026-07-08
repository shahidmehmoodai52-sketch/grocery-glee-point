
-- 1. Extend products with reorder / supply-chain fields
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS min_stock NUMERIC,
  ADD COLUMN IF NOT EXISTS max_stock NUMERIC,
  ADD COLUMN IF NOT EXISTS safety_stock NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_time_days INTEGER DEFAULT 7,
  ADD COLUMN IF NOT EXISTS preferred_supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reorder_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS abc_period_days INTEGER DEFAULT 90;

CREATE INDEX IF NOT EXISTS idx_products_preferred_supplier ON public.products(tenant_id, preferred_supplier_id);

-- 2. Core intelligence view (per product, tenant scoped by underlying RLS)
CREATE OR REPLACE VIEW public.product_intelligence
WITH (security_invoker = on)
AS
WITH sales_90 AS (
  SELECT
    m.tenant_id,
    m.product_id,
    ABS(SUM(m.qty_change) FILTER (WHERE m.created_at >= now() - INTERVAL '90 days')) AS qty_90,
    ABS(SUM(m.qty_change) FILTER (WHERE m.created_at >= now() - INTERVAL '30 days')) AS qty_30,
    ABS(SUM(m.qty_change) FILTER (WHERE m.created_at >= now() -  INTERVAL '7 days')) AS qty_7,
    ABS(SUM(m.qty_change) FILTER (WHERE m.created_at >= now() -  INTERVAL '365 days')) AS qty_365,
    SUM(ABS(m.qty_change) * COALESCE(m.unit_cost, 0)) FILTER (WHERE m.created_at >= now() - INTERVAL '90 days') AS cogs_90,
    MAX(m.created_at) FILTER (WHERE m.movement_type = 'sale') AS last_sale_at
  FROM public.inventory_movements m
  WHERE m.movement_type = 'sale'
  GROUP BY m.tenant_id, m.product_id
),
revenue_90 AS (
  SELECT
    si.tenant_id,
    si.product_id,
    SUM(si.line_total) AS revenue,
    SUM((si.price - COALESCE(si.cost, 0)) * si.qty) AS profit
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  WHERE s.created_at >= now() - INTERVAL '90 days'
  GROUP BY si.tenant_id, si.product_id
),
tenant_revenue AS (
  SELECT tenant_id, NULLIF(SUM(revenue), 0) AS total FROM revenue_90 GROUP BY tenant_id
),
ranked AS (
  SELECT
    r.tenant_id,
    r.product_id,
    r.revenue,
    r.profit,
    SUM(r.revenue) OVER (PARTITION BY r.tenant_id ORDER BY r.revenue DESC ROWS UNBOUNDED PRECEDING)
      / NULLIF(t.total, 0) AS cum_share
  FROM revenue_90 r
  LEFT JOIN tenant_revenue t ON t.tenant_id = r.tenant_id
),
near_expiry AS (
  SELECT tenant_id, product_id,
         MIN(expiry_date) FILTER (WHERE qty_remaining > 0 AND status = 'active') AS next_expiry,
         SUM(qty_remaining) FILTER (WHERE qty_remaining > 0 AND status = 'active' AND expiry_date <= CURRENT_DATE + 30) AS qty_expiring_30
  FROM public.product_batches
  GROUP BY tenant_id, product_id
)
SELECT
  p.id AS product_id,
  p.tenant_id,
  p.name,
  p.sku,
  p.unit,
  p.category,
  p.stock,
  p.cost_price,
  p.sell_price,
  p.min_stock,
  p.max_stock,
  COALESCE(p.safety_stock, 0) AS safety_stock,
  COALESCE(p.lead_time_days, 7) AS lead_time_days,
  p.preferred_supplier_id,
  p.reorder_qty,

  -- Sales velocity
  COALESCE(s90.qty_90, 0) AS sales_qty_90d,
  COALESCE(s90.qty_30, 0) AS sales_qty_30d,
  COALESCE(s90.qty_7,  0) AS sales_qty_7d,
  COALESCE(s90.qty_365, 0) AS sales_qty_365d,
  COALESCE(s90.qty_30, 0) / 30.0 AS avg_daily,
  COALESCE(s90.qty_30, 0) / 30.0 * 7.0  AS avg_weekly,
  COALESCE(s90.qty_30, 0) AS avg_monthly,

  -- Revenue / margin
  COALESCE(rev.revenue, 0) AS revenue_90d,
  COALESCE(rev.profit, 0)  AS profit_90d,
  COALESCE(s90.cogs_90, 0) AS cogs_90d,

  s90.last_sale_at,
  ne.next_expiry,
  COALESCE(ne.qty_expiring_30, 0) AS qty_expiring_30d,

  -- Days of inventory remaining
  CASE
    WHEN COALESCE(s90.qty_30, 0) = 0 THEN NULL
    ELSE p.stock / (s90.qty_30 / 30.0)
  END AS days_remaining,

  -- Inventory turnover (annualised) = COGS_90 * 4 / avg_inventory_value
  CASE
    WHEN COALESCE(p.stock * p.cost_price, 0) = 0 THEN NULL
    ELSE (COALESCE(s90.cogs_90, 0) * 4.0) / NULLIF(p.stock * p.cost_price, 0)
  END AS inventory_turnover,

  -- Sell-through rate 30d
  CASE
    WHEN COALESCE(p.stock + s90.qty_30, 0) = 0 THEN NULL
    ELSE s90.qty_30 / NULLIF(p.stock + s90.qty_30, 0)
  END AS sell_through_30d,

  -- Velocity class
  CASE
    WHEN COALESCE(s90.qty_90, 0) = 0 AND p.stock > 0 AND (s90.last_sale_at IS NULL OR s90.last_sale_at < now() - INTERVAL '90 days') THEN 'dead'
    WHEN COALESCE(s90.qty_30, 0) = 0 AND COALESCE(s90.qty_90, 0) > 0 THEN 'sleeping'
    WHEN COALESCE(s90.qty_30, 0) / 30.0 >= 1 THEN 'fast'
    WHEN COALESCE(s90.qty_30, 0) / 30.0 >= 0.1 THEN 'normal'
    ELSE 'slow'
  END AS velocity_class,

  -- ABC classification
  CASE
    WHEN ranked.cum_share IS NULL THEN 'C'
    WHEN ranked.cum_share <= 0.80 THEN 'A'
    WHEN ranked.cum_share <= 0.95 THEN 'B'
    ELSE 'C'
  END AS abc_class,

  -- Recommended reorder qty = (avg_daily * lead_time) + safety - stock, rounded up
  GREATEST(
    CEIL(
      (COALESCE(s90.qty_30, 0) / 30.0) * COALESCE(p.lead_time_days, 7)
      + COALESCE(p.safety_stock, 0)
      - COALESCE(p.stock, 0)
    )::numeric,
    0
  ) AS suggested_qty,

  -- Alert flags
  (p.stock <= 0) AS is_out_of_stock,
  (p.stock > 0 AND p.stock <= COALESCE(p.min_stock, p.low_stock_threshold, 5)) AS is_low_stock,
  (p.max_stock IS NOT NULL AND p.stock > p.max_stock) AS is_overstock,
  (COALESCE(s90.qty_90, 0) = 0 AND p.stock > 0) AS is_dead_stock,
  (ne.next_expiry IS NOT NULL AND ne.next_expiry <= CURRENT_DATE + 30) AS is_near_expiry,
  (COALESCE(s90.qty_7, 0) / 7.0) > (COALESCE(s90.qty_30, 0) / 30.0) * 2 AS is_sales_spike,
  (COALESCE(s90.qty_30, 0) > 0
     AND (COALESCE(s90.qty_7, 0) / 7.0) < (COALESCE(s90.qty_30, 0) / 30.0) * 0.5) AS is_sales_drop,

  -- Health score 0-100
  LEAST(100, GREATEST(0,
    CASE WHEN p.stock <= 0 THEN 0
         WHEN COALESCE(s90.qty_90, 0) = 0 THEN 20
         ELSE 60
              + CASE WHEN p.stock > COALESCE(p.min_stock, p.low_stock_threshold, 5) THEN 20 ELSE 0 END
              + CASE WHEN p.max_stock IS NULL OR p.stock <= p.max_stock THEN 10 ELSE -20 END
              + CASE WHEN ne.next_expiry IS NULL OR ne.next_expiry > CURRENT_DATE + 30 THEN 10 ELSE -10 END
    END
  )) AS health_score

FROM public.products p
LEFT JOIN sales_90 s90 ON s90.product_id = p.id
LEFT JOIN revenue_90 rev ON rev.product_id = p.id
LEFT JOIN ranked ON ranked.product_id = p.id
LEFT JOIN near_expiry ne ON ne.product_id = p.id
WHERE COALESCE(p.is_active, TRUE) = TRUE;

GRANT SELECT ON public.product_intelligence TO authenticated;

-- 3. Smart purchase suggestions view — grouped by supplier
CREATE OR REPLACE VIEW public.smart_purchase_suggestions
WITH (security_invoker = on)
AS
SELECT
  pi.tenant_id,
  pi.preferred_supplier_id AS supplier_id,
  s.name AS supplier_name,
  pi.product_id,
  pi.name AS product_name,
  pi.sku,
  pi.unit,
  pi.stock,
  pi.min_stock,
  pi.max_stock,
  pi.safety_stock,
  pi.lead_time_days,
  pi.avg_daily,
  pi.days_remaining,
  pi.velocity_class,
  pi.abc_class,
  COALESCE(pi.reorder_qty, pi.suggested_qty) AS suggested_qty,
  pi.cost_price,
  (COALESCE(pi.reorder_qty, pi.suggested_qty) * COALESCE(pi.cost_price, 0)) AS suggested_cost
FROM public.product_intelligence pi
LEFT JOIN public.suppliers s ON s.id = pi.preferred_supplier_id
WHERE pi.suggested_qty > 0
  AND (pi.is_low_stock OR pi.is_out_of_stock OR pi.days_remaining < COALESCE(pi.lead_time_days, 7) + 3);

GRANT SELECT ON public.smart_purchase_suggestions TO authenticated;
