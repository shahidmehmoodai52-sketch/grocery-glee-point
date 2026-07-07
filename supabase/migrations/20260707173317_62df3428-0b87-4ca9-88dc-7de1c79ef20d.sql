
-- ─────────────────────────────────────────────────────────────
-- billing_events: raw payment provider event log
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_event_id TEXT,
  amount NUMERIC(12,2),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.billing_events TO authenticated;
GRANT ALL ON public.billing_events TO service_role;

CREATE INDEX IF NOT EXISTS idx_billing_events_tenant       ON public.billing_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_created      ON public.billing_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_tenant_created
  ON public.billing_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_event_type   ON public.billing_events(event_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_events_provider_event
  ON public.billing_events(provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_events_select_member"
  ON public.billing_events
  FOR SELECT
  TO authenticated
  USING (tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), tenant_id));

-- ─────────────────────────────────────────────────────────────
-- invoices: per-tenant billing statements
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.tenant_subscriptions(id) ON DELETE SET NULL,
  invoice_number TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'draft',
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoices_status_chk CHECK (status IN ('draft','open','paid','void','uncollectible','refunded'))
);

GRANT SELECT ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;

CREATE INDEX IF NOT EXISTS idx_invoices_tenant         ON public.invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created        ON public.invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_created ON public.invoices(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status         ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription   ON public.invoices(subscription_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_tenant_invoice_number
  ON public.invoices(tenant_id, invoice_number)
  WHERE invoice_number IS NOT NULL;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_select_member"
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

DROP TRIGGER IF EXISTS trg_touch_invoices ON public.invoices;
CREATE TRIGGER trg_touch_invoices
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
