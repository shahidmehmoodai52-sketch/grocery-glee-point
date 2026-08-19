
REVOKE EXECUTE ON FUNCTION public.get_dashboard_stats(timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_stats(timestamp with time zone, timestamp with time zone) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(timestamp with time zone, timestamp with time zone) TO service_role;

REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO service_role;

REVOKE EXECUTE ON FUNCTION public.my_store_settings() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_store_settings() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_store_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_store_settings() TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_supplier_balances() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_supplier_balances() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_balances() TO service_role;
