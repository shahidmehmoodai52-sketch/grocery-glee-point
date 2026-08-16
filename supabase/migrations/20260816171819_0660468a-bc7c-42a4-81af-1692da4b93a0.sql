-- 1. Ensure authenticated users have INSERT grants on the relevant tables
-- Supabase requires explicit grants for PostgREST even if RLS exists.
GRANT INSERT ON public.party_payments TO authenticated;
GRANT INSERT ON public.cash_transactions TO authenticated;

-- 2. Drop existing restrictive INSERT policies if any
DROP POLICY IF EXISTS party_payments_insert_auth ON public.party_payments;
DROP POLICY IF EXISTS cash_tx_insert ON public.cash_transactions;

-- 3. Create permissive INSERT policies that respect tenant isolation
-- For party_payments: Allow insert if it belongs to the current tenant.
CREATE POLICY "party_payments_insert_auth" ON public.party_payments
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

-- For cash_transactions: Allow insert if it belongs to the current tenant.
-- Note: We allow all authenticated users to insert (e.g. for Cash Out), 
-- but restrict UPDATE/DELETE to admins as per existing policies.
CREATE POLICY "cash_tx_insert" ON public.cash_transactions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());
