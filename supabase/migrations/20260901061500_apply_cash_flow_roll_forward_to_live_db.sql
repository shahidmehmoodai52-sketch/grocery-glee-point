-- The 001e7f8/b7a38db opening-balance roll-forward fix (see
-- 20260828120000_cash_flow_opening_balance_roll_forward.sql and
-- 20260829100000_fix_cash_flow_summary_correct_signature.sql) was written
-- and verified against real tenant data restored into the migration-test
-- Supabase project, but had never actually been applied to the live
-- Lovable Cloud production database. A routine health check on 2026-09-01
-- confirmed the live get_cash_flow_summary and get_cash_flow_account_totals
-- still ran the old static-opening-balance logic: for one real account
-- (Hafiz Super Store & Bakers, "Cash in Hand"), "Today" was showing
-- Rs 1,520 while "All time" showed ~Rs 275,685 for the same account, right
-- now, in production.
--
-- This migration is a record of applying that already-written fix directly
-- to the live database (via the Lovable query_database tool, since this
-- project isn't reachable through the Supabase MCP server). The SQL below
-- is unchanged from the two migrations above -- reapplied here only so the
-- tracked migration history reflects what is now actually running live.
-- Verified post-apply: recomputing "Today" and "All time" balances for the
-- same real account now both equal Rs 275,685.41.

CREATE OR REPLACE FUNCTION public.get_cash_flow_summary(p_from_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_account_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_static_opening numeric;
  v_prior_in numeric;
  v_prior_out numeric;
  v_opening numeric;
  v_total_in numeric;
  v_total_out numeric;
  v_receivables numeric;
  v_payables numeric;
BEGIN
  SELECT sum(opening_balance) INTO v_static_opening
  FROM cash_accounts
  WHERE tenant_id = v_tenant_id AND (p_account_id IS NULL OR id = p_account_id);

  IF p_from_date IS NOT NULL THEN
    SELECT
      COALESCE(sum(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0),
      COALESCE(sum(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0)
    INTO v_prior_in, v_prior_out
    FROM public.get_cash_flow_ledger(NULL, p_from_date - interval '1 microsecond', p_account_id, NULL, 0, 1000000, NULL) l
    WHERE NOT EXISTS (
      SELECT 1 FROM cash_transactions ct
      WHERE ct.id::text = l.id AND ct.tenant_id = v_tenant_id AND ct.transfer_group_id IS NOT NULL
    );
  ELSE
    v_prior_in := 0;
    v_prior_out := 0;
  END IF;

  v_opening := COALESCE(v_static_opening, 0) + v_prior_in - v_prior_out;

  SELECT
    COALESCE(sum(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0)
  INTO v_total_in, v_total_out
  FROM public.get_cash_flow_ledger(p_from_date, p_to_date, p_account_id, NULL, 0, 1000000, NULL) l
  WHERE NOT EXISTS (
    SELECT 1
    FROM cash_transactions ct
    WHERE ct.id::text = l.id
      AND ct.tenant_id = v_tenant_id
      AND ct.transfer_group_id IS NOT NULL
  );

  SELECT COALESCE(sum(balance), 0) INTO v_receivables FROM customers WHERE tenant_id = v_tenant_id;

  SELECT COALESCE(sum(public.supplier_balance_calc(s.id)), 0) INTO v_payables
  FROM suppliers s WHERE s.tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'opening', v_opening,
    'total_in', v_total_in,
    'total_out', v_total_out,
    'balance', v_opening + v_total_in - v_total_out,
    'receivables', v_receivables,
    'payables', v_payables
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.get_cash_flow_summary(timestamp with time zone, timestamp with time zone, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.get_cash_flow_account_totals(timestamp with time zone, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.get_cash_flow_account_totals(
  p_from_date timestamp with time zone DEFAULT NULL,
  p_to_date timestamp with time zone DEFAULT NULL
)
RETURNS TABLE(account_id uuid, total_in numeric, total_out numeric, entry_count bigint, prior_in numeric, prior_out numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH period AS (
    SELECT l.account_id,
           COALESCE(SUM(CASE WHEN l.direction = 'in' THEN l.amount ELSE 0 END), 0)::numeric AS total_in,
           COALESCE(SUM(CASE WHEN l.direction = 'out' THEN l.amount ELSE 0 END), 0)::numeric AS total_out,
           COUNT(*)::bigint AS entry_count
    FROM public.get_cash_flow_ledger(p_from_date, p_to_date, NULL, NULL, 0, 100000000, NULL) l
    GROUP BY l.account_id
  ),
  prior AS (
    SELECT l.account_id,
           COALESCE(SUM(CASE WHEN l.direction = 'in' THEN l.amount ELSE 0 END), 0)::numeric AS prior_in,
           COALESCE(SUM(CASE WHEN l.direction = 'out' THEN l.amount ELSE 0 END), 0)::numeric AS prior_out
    FROM public.get_cash_flow_ledger(NULL, p_from_date - interval '1 microsecond', NULL, NULL, 0, 100000000, NULL) l
    WHERE p_from_date IS NOT NULL
    GROUP BY l.account_id
  )
  SELECT
    COALESCE(period.account_id, prior.account_id) AS account_id,
    COALESCE(period.total_in, 0) AS total_in,
    COALESCE(period.total_out, 0) AS total_out,
    COALESCE(period.entry_count, 0) AS entry_count,
    COALESCE(prior.prior_in, 0) AS prior_in,
    COALESCE(prior.prior_out, 0) AS prior_out
  FROM period
  FULL OUTER JOIN prior ON prior.account_id = period.account_id
$$;

GRANT EXECUTE ON FUNCTION public.get_cash_flow_account_totals(timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_flow_account_totals(timestamp with time zone, timestamp with time zone) TO service_role;
