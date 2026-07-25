
CREATE TABLE public.cash_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT current_tenant_id() REFERENCES public.tenants(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'cash',
  opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_accounts TO authenticated;
GRANT ALL ON public.cash_accounts TO service_role;
ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cash_accounts_select" ON public.cash_accounts FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "cash_accounts_insert" ON public.cash_accounts FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "cash_accounts_update" ON public.cash_accounts FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "cash_accounts_delete" ON public.cash_accounts FOR DELETE TO authenticated USING (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.cash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT current_tenant_id() REFERENCES public.tenants(id),
  account_id UUID NOT NULL REFERENCES public.cash_accounts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  occurred_on DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  category TEXT NOT NULL DEFAULT 'other',
  reference TEXT,
  notes TEXT,
  transfer_group_id UUID,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cash_tx_tenant_date_idx ON public.cash_transactions(tenant_id, occurred_on DESC);
CREATE INDEX cash_tx_account_idx ON public.cash_transactions(account_id, occurred_on DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_transactions TO authenticated;
GRANT ALL ON public.cash_transactions TO service_role;
ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cash_tx_select" ON public.cash_transactions FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "cash_tx_insert" ON public.cash_transactions FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "cash_tx_update" ON public.cash_transactions FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "cash_tx_delete" ON public.cash_transactions FOR DELETE TO authenticated USING (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_cash_accounts_updated_at BEFORE UPDATE ON public.cash_accounts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_cash_transactions_updated_at BEFORE UPDATE ON public.cash_transactions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
