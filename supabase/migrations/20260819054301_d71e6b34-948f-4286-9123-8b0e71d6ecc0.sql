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
DECLARE
    v_tenant uuid := public.current_tenant_id();
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(total), 0) as total_revenue,
        (SELECT COALESCE(SUM(total), 0) FROM public.purchases WHERE created_at >= p_from_date AND created_at <= p_to_date AND tenant_id = v_tenant) as total_purchases,
        (SELECT COALESCE(SUM(total), 0) FROM public.sale_returns WHERE created_at >= p_from_date AND created_at <= p_to_date AND tenant_id = v_tenant) as total_returns,
        COUNT(*) as sale_count
    FROM public.sales
    WHERE created_at >= p_from_date
      AND created_at <= p_to_date
      AND tenant_id = v_tenant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats TO authenticated;

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
DECLARE
    v_tenant uuid := public.current_tenant_id();
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
            COALESCE((SELECT SUM(p.total) FROM public.purchases p WHERE p.supplier_id = s.id AND p.tenant_id = v_tenant), 0) -
            COALESCE((SELECT SUM(pp.amount) FROM public.party_payments pp WHERE pp.party_id = s.id AND pp.party_type = 'supplier' AND pp.tenant_id = v_tenant), 0) -
            COALESCE((SELECT SUM(pr.total) FROM public.purchase_returns pr WHERE pr.supplier_id = s.id AND pr.tenant_id = v_tenant), 0)
        ) as current_balance,
        s.is_active
    FROM public.suppliers s
    WHERE s.tenant_id = v_tenant
    ORDER BY s.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_supplier_balances TO authenticated;

DROP TRIGGER IF EXISTS trg_fill_tenant_id ON public.purchase_items;
CREATE TRIGGER trg_fill_tenant_id BEFORE INSERT ON public.purchase_items
FOR EACH ROW EXECUTE FUNCTION public.fill_tenant_id();