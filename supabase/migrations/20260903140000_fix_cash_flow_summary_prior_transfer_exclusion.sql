-- get_cash_flow_summary's opening-balance roll-forward ("prior" in/out, before
-- p_from_date) excludes any ledger entry that belongs to a transfer
-- (cash_transactions.transfer_group_id IS NOT NULL). That exclusion is correct
-- for the IN-PERIOD total_in/total_out figures (the "Total received"/"Total
-- paid" cards intentionally show POS + manual cash movement, not internal
-- transfers between the shop's own accounts). But it is wrong for the PRIOR
-- roll-forward: a transfer is real money that actually left/entered a given
-- account, so dropping it from the opening-balance calculation understates
-- (or overstates) that account's true cash-on-hand. Confirmed live: for one
-- tenant/account this silently understated "Opening balance" by ~190,697.
-- get_cash_flow_account_totals (used by the per-account drill-down cards)
-- already includes transfers in its prior/opening math with no exclusion at
-- all, so this also fixes an inconsistency between the two RPCs for the same
-- account. Fix: keep the transfer exclusion on total_in/total_out only; drop
-- it from the prior_in/prior_out roll-forward.
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
    FROM public.get_cash_flow_ledger(NULL, p_from_date - interval '1 microsecond', p_account_id, NULL, 0, 1000000, NULL) l;
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
