-- The cash-flow "balance" fix (20260906070000_fix_cash_flow_summary_balance_transfer_consistency.sql)
-- was applied to Lovable Cloud but never carried over to the standalone
-- Supabase project (ubylxunrlzhijkelgxxx) during the Lovable -> Supabase
-- migration -- that project's get_cash_flow_summary still ran the older,
-- inconsistent-transfer-handling version. Now that the app has fully cut
-- over to this project as production (confirmed live: 382 sales in 24h),
-- that bug was back in production for real shops.
--
-- Reapplying the exact same fix here, unchanged. Verified post-apply on a
-- real account (Cash in Hand, Hafiz Super Store & Bakers): Today and
-- All-time balances match again (Rs 566,395.07 both).

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
  v_period_in_all numeric;
  v_period_out_all numeric;
  v_total_in numeric;
  v_total_out numeric;
  v_balance numeric;
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
    FROM public.get_cash_flow_ledger(NULL, p_from_date - interval '1 microsecond', p_account_id, NULL, 0, 1000000, NULL) l;
  ELSE
    v_prior_in := 0;
    v_prior_out := 0;
  END IF;

  v_opening := COALESCE(v_static_opening, 0) + v_prior_in - v_prior_out;

  SELECT
    COALESCE(sum(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0)
  INTO v_period_in_all, v_period_out_all
  FROM public.get_cash_flow_ledger(p_from_date, p_to_date, p_account_id, NULL, 0, 1000000, NULL) l;

  v_balance := v_opening + v_period_in_all - v_period_out_all;

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
    'balance', v_balance,
    'receivables', v_receivables,
    'payables', v_payables
  );
END $function$;
