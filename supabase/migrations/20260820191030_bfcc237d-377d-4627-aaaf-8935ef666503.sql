CREATE OR REPLACE FUNCTION public.get_cash_flow_account_totals(
  p_from_date timestamp with time zone DEFAULT NULL,
  p_to_date timestamp with time zone DEFAULT NULL
)
RETURNS TABLE(account_id uuid, total_in numeric, total_out numeric, entry_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT l.account_id,
         COALESCE(SUM(CASE WHEN l.direction = 'in' THEN l.amount ELSE 0 END), 0)::numeric,
         COALESCE(SUM(CASE WHEN l.direction = 'out' THEN l.amount ELSE 0 END), 0)::numeric,
         COUNT(*)::bigint
  FROM public.get_cash_flow_ledger(p_from_date, p_to_date, NULL, NULL, 0, 100000000, NULL) l
  GROUP BY l.account_id
$$;

GRANT EXECUTE ON FUNCTION public.get_cash_flow_account_totals(timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_flow_account_totals(timestamp with time zone, timestamp with time zone) TO service_role;