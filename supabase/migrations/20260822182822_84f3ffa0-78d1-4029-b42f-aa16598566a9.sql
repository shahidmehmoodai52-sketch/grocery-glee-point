CREATE OR REPLACE FUNCTION public.admin_shop_invoices(
  _tenant_id uuid,
  _payment_status text DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  invoice_no text,
  created_at timestamptz,
  customer_name text,
  total numeric,
  paid_amount numeric,
  balance numeric,
  total_count bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  WITH filtered AS (
    SELECT 
      s.id, s.invoice_no, s.created_at, s.customer_name, 
      s.total, s.paid_amount, (s.total - s.paid_amount) as balance
    FROM public.sales s
    WHERE s.tenant_id = _tenant_id
      AND (_payment_status IS NULL OR s.payment_status = _payment_status)
      AND (_from IS NULL OR s.created_at >= _from)
      AND (_to IS NULL OR s.created_at <= _to)
  )
  SELECT *, (SELECT count(*) FROM filtered) FROM filtered
  ORDER BY created_at DESC
  LIMIT _limit OFFSET _offset;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_shop_invoices(uuid, text, timestamptz, timestamptz, int, int) TO authenticated;
