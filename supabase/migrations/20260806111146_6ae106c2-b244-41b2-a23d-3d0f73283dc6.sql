ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash';

UPDATE public.cash_transactions SET payment_method = 'cash'
WHERE payment_method IS NULL OR btrim(payment_method) = '';

CREATE INDEX IF NOT EXISTS idx_cash_tx_tenant_occurred
  ON public.cash_transactions (tenant_id, occurred_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_tx_account
  ON public.cash_transactions (tenant_id, account_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_created
  ON public.sales (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_returns_tenant_created
  ON public.sale_returns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_tenant_created
  ON public.purchases (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_tenant_created
  ON public.purchase_returns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_created
  ON public.expenses (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_party_payments_tenant_created
  ON public.party_payments (tenant_id, created_at DESC);