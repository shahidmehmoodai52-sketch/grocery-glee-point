
-- RPC to get aggregated dashboard statistics efficiently
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
    p_from_date timestamptz,
    p_to_date timestamptz
)
RETURNS TABLE (
    total_revenue numeric,
    total_purchases numeric,
    total_returns numeric,
    sale_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(total), 0) as total_revenue,
        (SELECT COALESCE(SUM(total), 0) FROM public.purchases WHERE created_at >= p_from_date AND created_at <= p_to_date AND tenant_id = (auth.jwt()->>'tenant_id')::uuid) as total_purchases,
        (SELECT COALESCE(SUM(total), 0) FROM public.sale_returns WHERE created_at >= p_from_date AND created_at <= p_to_date AND tenant_id = (auth.jwt()->>'tenant_id')::uuid) as total_returns,
        COUNT(*) as sale_count
    FROM public.sales
    WHERE created_at >= p_from_date 
      AND created_at <= p_to_date
      AND tenant_id = (auth.jwt()->>'tenant_id')::uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats TO authenticated;

-- RPC to get supplier list with pre-calculated balances
CREATE OR REPLACE FUNCTION public.get_supplier_balances()
RETURNS TABLE (
    id uuid,
    name text,
    phone text,
    email text,
    address text,
    opening_balance numeric,
    current_balance numeric,
    is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.id,
        s.name,
        s.phone,
        s.email,
        s.address,
        s.opening_balance,
        (
            COALESCE(s.opening_balance, 0) + 
            COALESCE((SELECT SUM(total) FROM public.purchases p WHERE p.supplier_id = s.id), 0) - 
            COALESCE((SELECT SUM(amount) FROM public.party_payments pp WHERE pp.party_id = s.id AND pp.party_type = 'supplier'), 0) -
            COALESCE((SELECT SUM(total) FROM public.purchase_returns pr WHERE pr.supplier_id = s.id), 0)
        ) as current_balance,
        s.is_active
    FROM public.suppliers s
    WHERE s.tenant_id = (auth.jwt()->>'tenant_id')::uuid
    ORDER BY s.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_supplier_balances TO authenticated;

-- Optimization: Add indexes for frequently queried columns if not present
CREATE INDEX IF NOT EXISTS idx_sales_created_at_tenant ON public.sales(created_at, tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchases_created_at_tenant ON public.purchases(created_at, tenant_id);
CREATE INDEX IF NOT EXISTS idx_party_payments_party_id_type ON public.party_payments(party_id, party_type);
CREATE INDEX IF NOT EXISTS idx_products_barcode_tenant ON public.products(barcode, tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_sku_tenant ON public.products(sku, tenant_id);
