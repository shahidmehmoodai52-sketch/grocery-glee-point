-- Root cause fix: cash_accounts.opening_balance is a static, one-time value
-- (usually set when the account was created). get_cash_flow_summary and
-- get_cash_flow_account_totals were adding that same static value on top of
-- ONLY the transactions inside the selected date range — so picking "Today"
-- showed opening_balance + today's movement only, ignoring every day of real
-- cash flow between account creation and today. That produced the random,
-- disconnected "Today" numbers.
--
-- Fix: derive the opening balance for a period by rolling the static
-- opening_balance forward through every ledger entry that happened BEFORE
-- the period start (p_from_date). This mirrors the "prior" rollup the
-- frontend's drill-down dialog already computed correctly client-side
-- (cash-flow.tsx "Details" dialog), now made authoritative in the RPCs that
-- feed the summary cards and per-account cards.

-- 1) Cash flow summary: opening = static opening_balance + all movement before p_from_date
CREATE OR REPLACE FUNCTION public.get_cash_flow_summary(p_from_date timestamptz DEFAULT NULL, p_to_date timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF v_tenant_id IS NULL THEN RETURN NULL; END IF;

  -- Static opening balances (set once per account, e.g. at account creation)
  SELECT sum(opening_balance) INTO v_static_opening
  FROM cash_accounts
  WHERE tenant_id = v_tenant_id;

  -- Roll the static opening forward to the start of the selected period by
  -- folding in every ledger movement that happened before p_from_date.
  IF p_from_date IS NOT NULL THEN
    SELECT
      sum(CASE WHEN direction = 'in' THEN amount ELSE 0 END),
      sum(CASE WHEN direction = 'out' THEN amount ELSE 0 END)
    INTO v_prior_in, v_prior_out
    FROM public.get_cash_flow_ledger(NULL, p_from_date - interval '1 microsecond', NULL, NULL, 0, 1000000);
  ELSE
    v_prior_in := 0;
    v_prior_out := 0;
  END IF;

  v_opening := COALESCE(v_static_opening, 0) + COALESCE(v_prior_in, 0) - COALESCE(v_prior_out, 0);

  -- Totals from ledger scoped to the selected period only
  SELECT
    sum(CASE WHEN direction = 'in' THEN amount ELSE 0 END),
    sum(CASE WHEN direction = 'out' THEN amount ELSE 0 END)
  INTO v_total_in, v_total_out
  FROM public.get_cash_flow_ledger(p_from_date, p_to_date, NULL, NULL, 0, 1000000);

  -- Receivables = total customer balance
  SELECT sum(balance) INTO v_receivables
  FROM customers
  WHERE tenant_id = v_tenant_id;

  -- Payables = total supplier balance
  SELECT sum(balance) INTO v_payables
  FROM suppliers
  WHERE tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'opening', v_opening,
    'total_in', COALESCE(v_total_in, 0),
    'total_out', COALESCE(v_total_out, 0),
    'balance', v_opening + COALESCE(v_total_in, 0) - COALESCE(v_total_out, 0),
    'receivables', COALESCE(v_receivables, 0),
    'payables', COALESCE(v_payables, 0)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_cash_flow_summary(timestamptz, timestamptz) TO authenticated;

-- 2) Per-account totals: also return prior_in/prior_out (movement before
-- p_from_date, per account) so the frontend can roll each account's own
-- opening_balance forward the same way, instead of using the raw static value.
-- Return type is changing, so the old function must be dropped first.
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
