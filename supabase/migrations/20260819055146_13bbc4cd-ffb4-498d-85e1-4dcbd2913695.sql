ALTER FUNCTION public.get_supplier_ledger(uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_supplier_balances() SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.get_supplier_ledger(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_supplier_balances() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_supplier_ledger(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_ledger(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_supplier_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_balances() TO service_role;