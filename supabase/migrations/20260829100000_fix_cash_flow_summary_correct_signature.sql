-- Correction to the previous 20260828120000_cash_flow_opening_balance_roll_forward.sql
-- migration.
--
-- That migration was written against the get_cash_flow_summary(timestamptz,
-- timestamptz) signature found in the ORIGINAL migration file
-- (20260820180836_...). It turns out the live production database's actual
-- current get_cash_flow_summary function had already evolved past that:
-- it gained a third p_account_id parameter, excludes transfer-linked
-- ledger entries from the in/out totals, and computes payables via
-- public.supplier_balance_calc() instead of the cached suppliers.balance
-- column — none of which was captured by any tracked migration file (the
-- change was made directly against the database, outside this migrations/
-- folder). Applying the old 2-arg fix on top of that live schema created a
-- second, ambiguous overload instead of actually fixing the real function
-- the frontend calls (cash-flow.tsx calls it with all three arguments).
--
-- This migration supersedes the stale 2-arg version and reapplies the same
-- opening-balance roll-forward fix to the ACTUAL 3-arg function, preserving
-- every other piece of its existing logic unchanged. Verified against real
-- tenant data: "Today" and "All time" cash-on-hand balances now match
-- exactly, as they must (both are the same running total, just computed
-- through different day-windows).

DROP FUNCTION IF EXISTS public.get_cash_flow_summary(timestamp with time zone, timestamp with time zone);

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

  -- Root-cause fix: roll the static opening_balance forward through every
  -- ledger movement that happened before p_from_date (same transfer-group
  -- exclusion as the period totals below), instead of using the raw static
  -- value for every date range. This is what made "Today" show random,
  -- disconnected numbers before.
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

  -- Payables derived from documents, not the cached column, so the card stays
  -- correct even if suppliers.balance drifts.
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
