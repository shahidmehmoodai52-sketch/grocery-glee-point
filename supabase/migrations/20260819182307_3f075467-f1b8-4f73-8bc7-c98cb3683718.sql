DROP FUNCTION IF EXISTS public.get_supplier_balances();

CREATE OR REPLACE FUNCTION public.get_supplier_balances()
RETURNS TABLE(id uuid, name text, phone text, email text, address text, opening_balance numeric, current_balance numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
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
      COALESCE((SELECT SUM(p.total - p.paid) FROM public.purchases p WHERE p.supplier_id = s.id AND p.tenant_id = v_tenant), 0) -
      COALESCE((SELECT SUM(pp.amount) FROM public.party_payments pp WHERE pp.party_id = s.id AND pp.party_type = 'supplier' AND pp.tenant_id = v_tenant), 0) -
      COALESCE((SELECT SUM(pr.total) FROM public.purchase_returns pr WHERE pr.supplier_id = s.id AND pr.tenant_id = v_tenant), 0)
    ) AS current_balance
  FROM public.suppliers s
  WHERE s.tenant_id = v_tenant
  ORDER BY s.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_supplier_balances() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_supplier_balances() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_balances() TO service_role;