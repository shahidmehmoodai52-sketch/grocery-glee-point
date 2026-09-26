-- get_customer_balances() (Customers list) decided whether a customer
-- payment was a "Cash Out" purely from its note text (/^\s*cash\s*out\b/),
-- while the customer ledger page (src/lib/customer-ledger.ts, since
-- d77c7d0) decides it from the linked cash_transactions row's own
-- `direction` ('out'), falling back to the note only when there is no
-- linked transaction. Any Cash Out whose note doesn't literally start with
-- "Cash Out" was therefore counted as a payment received on the list
-- (-amount) and as a Cash Out in the ledger (+amount): a 2 x amount gap
-- between the list balance and the ledger's closing balance.
--
-- Seen live: Hafiz Mart customer 920-G, Rs 1100 "Cash Paid Asif & Other
-- (500+600)" with direction 'out' -> list showed -30, ledger 2170.
--
-- Same signature and output columns; only the cash-out classification
-- changes, to exactly match the ledger's rule.
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
      + COALESCE((
          SELECT SUM(
            CASE
              WHEN CASE
                     WHEN ct.direction IS NOT NULL THEN ct.direction = 'out'
                     ELSE COALESCE(pp.note, '') ~* '^\s*cash\s*out\y'
                   END
              THEN pp.amount
              ELSE -pp.amount
            END
          )
          FROM public.party_payments pp
          LEFT JOIN public.cash_transactions ct ON ct.id = pp.cash_transaction_id
          WHERE pp.party_id = c.id AND pp.party_type = 'customer' AND pp.tenant_id = v_tenant
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
