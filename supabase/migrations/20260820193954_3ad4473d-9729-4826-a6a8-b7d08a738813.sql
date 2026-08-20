CREATE OR REPLACE FUNCTION public.get_cash_flow_ledger(p_from_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_account_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 1000, p_payment_method text DEFAULT NULL::text)
 RETURNS TABLE(id text, occurred_on date, created_at timestamp with time zone, direction text, amount numeric, category text, reference text, notes text, account_id uuid, account_name text, payment_method text, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
BEGIN
  RETURN QUERY
  WITH raw_entries AS (
    SELECT 
      ct.id::text as e_id, ct.occurred_on as e_occurred_on, ct.created_at as e_created_at, ct.direction as e_direction, ct.amount as e_amount, ct.category as e_category,
      ct.reference as e_reference, ct.notes as e_notes, ct.account_id as e_account_id, ca.name as e_account_name, ct.payment_method as e_payment_method
    FROM cash_transactions ct
    LEFT JOIN cash_accounts ca ON ca.id = ct.account_id
    WHERE ct.tenant_id = v_tenant_id
    UNION ALL
    SELECT 
      'sale:' || s.id, s.created_at::date, s.created_at, 'in', s.paid, 'sale',
      s.invoice_no, c.name,
      (SELECT ca2.id FROM cash_accounts ca2 WHERE ca2.tenant_id = v_tenant_id AND ca2.type = public.resolve_payment_bucket(s.payment_method) AND ca2.is_active LIMIT 1),
      s.payment_method, s.payment_method
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.tenant_id = v_tenant_id AND s.paid > 0 AND s.status != 'voided' AND s.expense_person_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM cash_transactions ct2 WHERE ct2.tenant_id = v_tenant_id AND ct2.reference = s.invoice_no)
    UNION ALL
    SELECT 
      'sret:' || sr.id, sr.created_at::date, sr.created_at, 'out', sr.refund_amount, 'sale_return',
      sr.return_no, c.name,
      (SELECT ca2.id FROM cash_accounts ca2 WHERE ca2.tenant_id = v_tenant_id AND ca2.type = public.resolve_payment_bucket(sr.refund_method) AND ca2.is_active LIMIT 1),
      sr.refund_method, sr.refund_method
    FROM sale_returns sr
    LEFT JOIN customers c ON c.id = sr.customer_id
    WHERE sr.tenant_id = v_tenant_id AND sr.refund_amount > 0
    AND NOT EXISTS (SELECT 1 FROM cash_transactions ct2 WHERE ct2.tenant_id = v_tenant_id AND ct2.reference = sr.return_no)
    UNION ALL
    SELECT 
      'pur:' || p.id, p.created_at::date, p.created_at, 'out', p.paid, 'purchase',
      p.invoice_no, sup.name,
      COALESCE(p.account_id, (SELECT ca2.id FROM cash_accounts ca2 WHERE ca2.tenant_id = v_tenant_id AND ca2.type = public.resolve_payment_bucket(p.payment_method) AND ca2.is_active LIMIT 1)),
      p.payment_method, p.payment_method
    FROM purchases p
    LEFT JOIN suppliers sup ON sup.id = p.supplier_id
    WHERE p.tenant_id = v_tenant_id AND p.paid > 0
    AND NOT EXISTS (SELECT 1 FROM cash_transactions ct2 WHERE ct2.tenant_id = v_tenant_id AND ct2.reference = p.invoice_no)
    UNION ALL
    SELECT 
      'exp:' || e.id, e.expense_date, e.created_at, 'out', e.amount, 'expense',
      e.category, e.description,
      (SELECT ca2.id FROM cash_accounts ca2 WHERE ca2.tenant_id = v_tenant_id AND ca2.type = public.resolve_payment_bucket(e.method) AND ca2.is_active LIMIT 1),
      e.method, e.method
    FROM expenses e
    WHERE e.tenant_id = v_tenant_id
    AND NOT EXISTS (SELECT 1 FROM cash_transactions ct2 WHERE ct2.tenant_id = v_tenant_id AND ct2.category = 'expense' AND ct2.amount = e.amount AND abs(extract(epoch from (ct2.created_at - e.created_at))) < 2)
  ),
  filtered AS (
    SELECT *
    FROM raw_entries
    WHERE (p_from_date IS NULL OR e_created_at >= p_from_date)
      AND (p_to_date IS NULL OR e_created_at <= p_to_date)
      AND (p_account_id IS NULL OR e_account_id = p_account_id)
      AND (p_payment_method IS NULL OR lower(e_payment_method) = lower(p_payment_method))
      AND (p_search IS NULL OR e_reference ILIKE '%' || p_search || '%' OR e_notes ILIKE '%' || p_search || '%')
  )
  SELECT e_id, e_occurred_on, e_created_at, e_direction, e_amount, e_category, e_reference, e_notes, e_account_id, e_account_name, e_payment_method,
    count(*) OVER() as total_count
  FROM filtered
  ORDER BY e_created_at DESC
  OFFSET p_offset
  LIMIT p_limit;
END $function$;