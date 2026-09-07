-- The Customers list page computed every customer's balance client-side by
-- downloading the tenant's ENTIRE sales/party_payments/sale_returns tables
-- (fetchAll, no bound) just to sum a handful of numbers per customer. For a
-- shop with real transaction history this re-downloads thousands of
-- unrelated rows every time the Customers page is opened. Mirrors the
-- existing get_supplier_balances() RPC (suppliers.index.tsx), computing the
-- same closing balance server-side per customer instead.
--
-- The formula exactly replicates src/lib/customer-ledger.ts's
-- buildLedgerEntries()/summarizeCustomerLedger() (verified line-by-line, and
-- cross-checked against real production data before this migration was
-- written -- see PR description):
--   closing = opening_balance
--           + sum(sale.total - sale.paid)              -- each invoice's unpaid remainder
--           - sum(sale_return.total)
--           - sum(payment.amount)   for payments that are NOT a "cash out"
--           + sum(payment.amount)   for payments that ARE a "cash out"
-- A payment is a "cash out" (money handed TO the customer, so it INCREASES
-- what they owe rather than reducing it) purely by its note text matching
-- the client's /^\s*cash\s*out\b/i -- there's no dedicated column for it.
-- Below uses \y, not \b, for the word boundary: Postgres's regex engine
-- (POSIX ARE) treats \b as a literal backspace character, not a word
-- boundary -- \y is its actual word-boundary escape. Verified against both
-- forms live before writing this migration; \b silently matched nothing.
-- NULL notes are never a cash-out (matches the client's `p.note ?? ""`).
CREATE OR REPLACE FUNCTION public.get_customer_balances()
RETURNS TABLE(
  id uuid,
  name text,
  phone text,
  email text,
  address text,
  opening_balance numeric,
  current_balance numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.phone,
    c.email,
    c.address,
    c.opening_balance,
    (
      COALESCE(c.opening_balance, 0)
      + COALESCE((
          SELECT SUM(s.total - s.paid)
          FROM public.sales s
          WHERE s.customer_id = c.id AND s.tenant_id = v_tenant
        ), 0)
      - COALESCE((
          SELECT SUM(sr.total)
          FROM public.sale_returns sr
          WHERE sr.customer_id = c.id AND sr.tenant_id = v_tenant
        ), 0)
      - COALESCE((
          SELECT SUM(pp.amount)
          FROM public.party_payments pp
          WHERE pp.party_id = c.id AND pp.party_type = 'customer' AND pp.tenant_id = v_tenant
            AND COALESCE(pp.note, '') !~* '^\s*cash\s*out\y'
        ), 0)
      + COALESCE((
          SELECT SUM(pp.amount)
          FROM public.party_payments pp
          WHERE pp.party_id = c.id AND pp.party_type = 'customer' AND pp.tenant_id = v_tenant
            AND COALESCE(pp.note, '') ~* '^\s*cash\s*out\y'
        ), 0)
    ) AS current_balance
  FROM public.customers c
  WHERE c.tenant_id = v_tenant
  ORDER BY c.name;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_customer_balances() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_customer_balances() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_customer_balances() TO authenticated;
