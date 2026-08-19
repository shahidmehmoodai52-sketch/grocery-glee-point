CREATE OR REPLACE FUNCTION public.get_supplier_ledger(p_supplier_id uuid)
RETURNS TABLE (
  id uuid,
  occurred_at timestamptz,
  entry_type text,
  reference text,
  note text,
  debit numeric,
  credit numeric,
  source_data jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH tenant AS (
    SELECT public.current_tenant_id() AS id
  ), allowed_supplier AS (
    SELECT s.id
    FROM public.suppliers s, tenant t
    WHERE s.id = p_supplier_id
      AND s.tenant_id = t.id
  )
  SELECT p.id, p.created_at, 'purchase'::text, p.invoice_no, COALESCE(p.note, ''),
         p.total, 0::numeric, to_jsonb(p)
  FROM public.purchases p
  JOIN allowed_supplier s ON s.id = p.supplier_id

  UNION ALL

  SELECT NULL::uuid, p.created_at, 'invoice_payment'::text,
         p.invoice_no || ' · on-invoice', 'Paid at purchase'::text,
         0::numeric, p.paid, jsonb_build_object('purchase_id', p.id, 'paid', p.paid)
  FROM public.purchases p
  JOIN allowed_supplier s ON s.id = p.supplier_id
  WHERE p.paid > 0

  UNION ALL

  SELECT pp.id, pp.created_at, 'payment'::text, COALESCE(pp.method, 'Payment'),
         COALESCE(pp.note, ''), 0::numeric, pp.amount, to_jsonb(pp)
  FROM public.party_payments pp
  JOIN allowed_supplier s ON s.id = pp.party_id
  WHERE pp.party_type = 'supplier'

  UNION ALL

  SELECT pr.id, pr.created_at, 'return'::text, COALESCE(pr.return_no, 'Return'),
         COALESCE(pr.note, ''), 0::numeric, pr.total, to_jsonb(pr)
  FROM public.purchase_returns pr
  JOIN allowed_supplier s ON s.id = pr.supplier_id

  ORDER BY 2;
$$;

REVOKE ALL ON FUNCTION public.get_supplier_ledger(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_supplier_ledger(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_ledger(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_supplier_balances()
RETURNS TABLE(id uuid, name text, phone text, email text, address text, opening_balance numeric, current_balance numeric, is_active boolean)
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
    ) AS current_balance,
    s.is_active
  FROM public.suppliers s
  WHERE s.tenant_id = v_tenant
  ORDER BY s.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_supplier_balances() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_supplier_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_balances() TO service_role;