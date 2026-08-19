
CREATE OR REPLACE FUNCTION public.get_supplier_ledger(p_supplier_id uuid)
 RETURNS TABLE(id uuid, occurred_at timestamp with time zone, entry_type text, reference text, note text, debit numeric, credit numeric, source_data jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
 DECLARE
   v_tenant_id uuid := public.current_tenant_id();
 BEGIN
   IF v_tenant_id IS NULL OR NOT EXISTS (
     SELECT 1 FROM public.suppliers s
     WHERE s.id = p_supplier_id AND s.tenant_id = v_tenant_id
   ) THEN
     SELECT s.tenant_id INTO v_tenant_id
     FROM public.suppliers s
     WHERE s.id = p_supplier_id
       AND EXISTS (
         SELECT 1 FROM public.tenant_members tm
         WHERE tm.tenant_id = s.tenant_id AND tm.user_id = auth.uid()
       )
     LIMIT 1;
   END IF;

   IF v_tenant_id IS NULL THEN
     RETURN;
   END IF;

   IF NOT EXISTS (
     SELECT 1 FROM public.suppliers s
     WHERE s.id = p_supplier_id AND s.tenant_id = v_tenant_id
   ) THEN
     RETURN;
   END IF;

   RETURN QUERY
   SELECT * FROM (
     SELECT p.id, p.created_at as occurred_at, 'purchase'::text as entry_type, p.invoice_no as reference, COALESCE(p.note, '') as note, p.total as debit, 0::numeric as credit, to_jsonb(p) as source_data
     FROM public.purchases p
     WHERE p.supplier_id = p_supplier_id AND p.tenant_id = v_tenant_id
     UNION ALL
     SELECT NULL::uuid, p.created_at as occurred_at, 'invoice_payment'::text as entry_type, p.invoice_no || ' · on-invoice' as reference, 'Paid at purchase'::text as note, 0::numeric as debit, p.paid as credit, jsonb_build_object('purchase_id', p.id, 'paid', p.paid) as source_data
     FROM public.purchases p
     WHERE p.supplier_id = p_supplier_id AND p.paid > 0 AND p.tenant_id = v_tenant_id
     UNION ALL
     SELECT pp.id, pp.created_at as occurred_at, 'payment'::text as entry_type, COALESCE(pp.method, 'Payment') as reference, COALESCE(pp.note, '') as note, 0::numeric as debit, pp.amount as credit, to_jsonb(pp) as source_data
     FROM public.party_payments pp
     WHERE pp.party_id = p_supplier_id AND pp.party_type = 'supplier' AND pp.tenant_id = v_tenant_id
     UNION ALL
     SELECT pr.id, pr.created_at as occurred_at, 'return'::text as entry_type, COALESCE(pr.return_no, 'Return') as reference, COALESCE(pr.note, '') as note, 0::numeric as debit, pr.total as credit, to_jsonb(pr) as source_data
     FROM public.purchase_returns pr
     WHERE pr.supplier_id = p_supplier_id AND pr.tenant_id = v_tenant_id
   ) sub
   ORDER BY occurred_at;
 END;
$$;

GRANT EXECUTE ON FUNCTION public.get_supplier_ledger(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_ledger(uuid) TO service_role;
