-- Root cause found while fixing the recalc-supplier-balances cron job
-- (which had been failing every night since before the migration with
-- "Not authenticated"): the failure was masking a second, deeper bug.
--
-- public.supplier_balance_calc() gates on auth.uid() being a real logged-in
-- tenant member (correctly -- it's EXECUTE-granted to PUBLIC, so any
-- authenticated user can call it directly via supabase.rpc(), and that
-- check is what stops one tenant's user from reading another tenant's
-- supplier balance). But run_health_check() -- itself run from pg_cron,
-- with no logged-in user -- also calls supplier_balance_calc() for its
-- supplier_balance_drift check. With auth.uid() NULL there, the function
-- returns NULL for every supplier, so "balance IS DISTINCT FROM NULL" was
-- true for literally every supplier in the system -- confirmed live: the
-- health check's reported drift count (163) exactly matched the total
-- supplier count (163), for every single day since the health-check cron
-- was last working. It was never measuring real drift.
--
-- Fix: add a separate, internal-only unchecked calculation function with
-- none of supplier_balance_calc's auth/tenant gating -- explicitly NOT
-- granted to PUBIC/anon/authenticated, so it can't be reached the way
-- supplier_balance_calc can. Both cron-triggered functions
-- (cron_recalc_all_supplier_balances and run_health_check) now use this
-- instead. supplier_balance_calc itself is untouched, so its exposure to
-- the frontend is exactly as secure as before.
--
-- Verified live: cron_recalc_all_supplier_balances() found only 3 suppliers
-- with real drift (not 163) and fixed them; run_health_check() now reports
-- supplier_balance_drift as 0 ("total drift Rs 0"), correctly.

CREATE OR REPLACE FUNCTION public._supplier_balance_calc_unchecked(p_supplier_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN round(
      COALESCE((SELECT s.opening_balance FROM suppliers s WHERE s.id = p_supplier_id), 0)
    + COALESCE((SELECT sum(p.total) FROM purchases p WHERE p.supplier_id = p_supplier_id), 0)
    - COALESCE((SELECT sum(p.paid)  FROM purchases p WHERE p.supplier_id = p_supplier_id), 0)
    - COALESCE((SELECT sum(p.incentive_amount) FROM purchases p WHERE p.supplier_id = p_supplier_id), 0)
    - COALESCE((SELECT sum(pr.total) FROM purchase_returns pr WHERE pr.supplier_id = p_supplier_id), 0)
    - COALESCE((SELECT sum(pp.amount) FROM party_payments pp
                 WHERE pp.party_id = p_supplier_id
                   AND (pp.party_type IS NULL OR pp.party_type = 'supplier')), 0)
  , 2);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._supplier_balance_calc_unchecked(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._supplier_balance_calc_unchecked(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._supplier_balance_calc_unchecked(uuid) FROM authenticated;

-- Cron-only recalc, invoked by the recalc-supplier-balances job instead of
-- the auth-gated public.recalc_supplier_balances() RPC (which stays
-- unchanged for its real caller: an authenticated super-admin from the UI).
CREATE OR REPLACE FUNCTION public.cron_recalc_all_supplier_balances()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  UPDATE suppliers s
  SET balance = public._supplier_balance_calc_unchecked(s.id)
  WHERE s.balance IS DISTINCT FROM public._supplier_balance_calc_unchecked(s.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;

SELECT cron.unschedule('recalc-supplier-balances');
SELECT cron.schedule('recalc-supplier-balances', '30 3 * * *', 'SELECT public.cron_recalc_all_supplier_balances();');

CREATE OR REPLACE FUNCTION public.run_health_check()
 RETURNS TABLE(check_name text, severity text, issue_count bigint, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  CREATE TEMP TABLE _hc(check_name text, severity text, issue_count bigint, detail text) ON COMMIT DROP;

  INSERT INTO _hc
  SELECT 'cross_tenant_leak', 'CRITICAL', count(*), 'records linked across shops'
  FROM (
    SELECT 1 FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.tenant_id<>c.tenant_id
    UNION ALL SELECT 1 FROM sale_returns sr JOIN sales s ON s.id=sr.sale_id WHERE sr.tenant_id<>s.tenant_id
    UNION ALL SELECT 1 FROM purchases p JOIN suppliers su ON su.id=p.supplier_id WHERE p.tenant_id<>su.tenant_id
    UNION ALL SELECT 1 FROM cash_transactions ct JOIN cash_accounts ca ON ca.id=ct.account_id WHERE ct.tenant_id<>ca.tenant_id
    UNION ALL SELECT 1 FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.tenant_id<>s.tenant_id
    UNION ALL SELECT 1 FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id WHERE pi.tenant_id<>p.tenant_id
    UNION ALL SELECT 1 FROM party_payments pp LEFT JOIN customers c ON c.id=pp.party_id
         LEFT JOIN suppliers su ON su.id=pp.party_id WHERE pp.tenant_id<>COALESCE(c.tenant_id,su.tenant_id)
  ) x;

  INSERT INTO _hc
  SELECT 'invoice_collision_across_shops', 'CRITICAL', count(*), 'invoice numbers shared by 2+ shops'
  FROM (SELECT invoice_no FROM sales GROUP BY 1 HAVING count(DISTINCT tenant_id)>1) y;

  INSERT INTO _hc
  SELECT 'duplicate_invoice_in_shop', 'CRITICAL', count(*), 'same invoice twice in one shop'
  FROM (SELECT tenant_id, invoice_no FROM sales GROUP BY 1,2 HAVING count(*)>1) z;

  INSERT INTO _hc
  SELECT 'unbalanced_transfers', 'HIGH', count(*), 'money left one account but did not arrive'
  FROM (
    SELECT transfer_group_id FROM cash_transactions WHERE category='transfer'
    GROUP BY 1 HAVING count(*)<>2 OR sum(CASE WHEN direction='in' THEN amount ELSE -amount END)<>0
  ) t;

  -- Uses the unchecked internal calc (not the auth-gated public
  -- supplier_balance_calc, which returns NULL here since this runs with no
  -- logged-in user and would otherwise flag every supplier as "drifted").
  INSERT INTO _hc
  SELECT 'supplier_balance_drift', 'HIGH', count(*),
         'total drift Rs ' || COALESCE(round(sum(abs(s.balance-public._supplier_balance_calc_unchecked(s.id))),2),0)
  FROM suppliers s WHERE s.balance IS DISTINCT FROM public._supplier_balance_calc_unchecked(s.id);

  INSERT INTO _hc
  SELECT 'purchase_header_vs_items', 'HIGH', count(*), 'purchase total does not match its lines'
  FROM purchases p JOIN (SELECT purchase_id, sum(line_total) t FROM purchase_items GROUP BY 1) i
    ON i.purchase_id=p.id WHERE abs(p.subtotal-i.t)>0.01;

  INSERT INTO _hc
  SELECT 'sale_header_vs_items', 'HIGH', count(*), 'sale total does not match its lines'
  FROM sales s JOIN (SELECT sale_id, sum(line_total) t FROM sale_items GROUP BY 1) i
    ON i.sale_id=s.id WHERE abs(s.subtotal-i.t)>0.01;

  INSERT INTO _hc
  SELECT 'supplier_overpaid', 'HIGH', count(*), 'supplier balance is negative by more than Rs 10'
  FROM suppliers WHERE balance < -10;

  INSERT INTO _hc
  SELECT 'staff_purchase_moving_cash', 'MEDIUM', count(*), 'staff purchase counted as cash out again'
  FROM cash_transactions WHERE category='staff_purchase';

  INSERT INTO _hc
  SELECT 'document_math_error', 'MEDIUM', count(*), 'total <> subtotal + tax - discount'
  FROM (
    SELECT 1 FROM sales WHERE abs(total-(subtotal+tax-discount))>0.01
    UNION ALL SELECT 1 FROM purchases WHERE abs(subtotal+tax-total)>0.01
  ) m;

  INSERT INTO _hc
  SELECT 'user_without_pinned_shop', 'MEDIUM', count(*), 'multi-shop user may see the wrong shop'
  FROM (
    SELECT tm.user_id FROM tenant_members tm
    JOIN auth.users u ON u.id=tm.user_id
    WHERE u.raw_app_meta_data->>'tenant_id' IS NULL
    GROUP BY tm.user_id HAVING count(*)>1
  ) w;

  INSERT INTO _hc
  SELECT 'negative_stock', 'LOW', count(*), 'products showing negative stock'
  FROM products WHERE stock < 0;

  INSERT INTO public.system_health_log (check_name, severity, issue_count, detail)
  SELECT h.check_name, h.severity, h.issue_count, h.detail FROM _hc h;

  RETURN QUERY SELECT h.check_name, h.severity, h.issue_count, h.detail
               FROM _hc h ORDER BY
                 CASE h.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2
                                 WHEN 'MEDIUM' THEN 3 ELSE 4 END, h.issue_count DESC;
END $function$;
