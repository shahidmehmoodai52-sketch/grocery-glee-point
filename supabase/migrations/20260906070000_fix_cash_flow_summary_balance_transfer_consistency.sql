-- Root cause of the Today != All-time regression reintroduced by
-- 20260903140000_fix_cash_flow_summary_prior_transfer_exclusion.sql:
--
-- That migration made the "prior" (opening-balance roll-forward) window
-- include transfers, while the in-period "total_in"/"total_out" window kept
-- excluding them. Both changes were individually reasonable (opening
-- balance must reflect a transfer's real cash effect on the account; the
-- "Total received"/"Total paid" cards should show POS + manual movement
-- only, not internal transfers) but combining them broke the invariant:
-- the same transfer transaction is counted when it falls inside "prior"
-- but dropped when it falls inside "in-period" -- and which window it
-- lands in depends entirely on where p_from_date is set. So "Today" and
-- "All time" landed on different balances for the same account, right now,
-- in production -- confirmed on real accounts:
--   Babar E/J (Hafiz Super Store): Today -5,823 vs All time 2,070
--   BAF (AL-TAJ MART): Today 694,397.15 vs All time 226,177.00
--   Cash in Hand (Hafiz Super Store): Today 330,318.40 vs All time 207,932.32
--
-- Fix: decouple "balance" from the transfer-excluded total_in/total_out.
-- "balance" is now always static_opening + every ledger movement up to
-- p_to_date (transfers included, computed the same way whether that
-- movement falls in "prior" or "in-period") -- so it no longer matters how
-- the span is split, and Today/All-time always agree. The transfer-excluded
-- total_in/total_out are kept, unchanged, purely for the display cards.
--
-- Verified live against the same three real accounts above: Today and All
-- time now match exactly (-5,823 / 765,643.86 / 530,651.40 respectively).

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

  -- Opening-balance roll-forward: unfiltered (transfers included), because a
  -- transfer really moved money into/out of this account.
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

  -- In-period totals, unfiltered (transfers included) -- used ONLY for the
  -- running cash balance, so "balance" always equals static_opening + every
  -- movement up to p_to_date, regardless of how that span is split between
  -- "prior" and "in-period". This is what makes "Today" and "All time"
  -- agree: both are just the same running total through a different
  -- day-window, and a transfer is counted exactly once either way.
  SELECT
    COALESCE(sum(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0)
  INTO v_period_in_all, v_period_out_all
  FROM public.get_cash_flow_ledger(p_from_date, p_to_date, p_account_id, NULL, 0, 1000000, NULL) l;

  v_balance := v_opening + v_period_in_all - v_period_out_all;

  -- Display-only totals ("Total received"/"Total paid" cards) exclude
  -- transfers on purpose -- those cards are meant to show POS + manual cash
  -- movement, not the shop moving money between its own accounts. This no
  -- longer affects the balance calculation above.
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
