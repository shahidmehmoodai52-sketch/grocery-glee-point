
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_from_date timestamp with time zone, p_to_date timestamp with time zone)
 RETURNS TABLE(total_revenue numeric, total_purchases numeric, total_returns numeric, sale_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_store_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_balances() TO authenticated;
