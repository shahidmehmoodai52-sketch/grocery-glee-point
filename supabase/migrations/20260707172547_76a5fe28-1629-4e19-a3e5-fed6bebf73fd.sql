
-- 1) Plans catalog
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  price_monthly NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_users INTEGER,
  max_products INTEGER,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscription_plans TO authenticated;
GRANT ALL ON public.subscription_plans TO service_role;

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plans_select_active_authenticated"
  ON public.subscription_plans
  FOR SELECT
  TO authenticated
  USING (active = true);

-- 2) Tenant subscriptions
CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'trialing',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_subscriptions_status_chk CHECK (status IN ('trialing','active','past_due','cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_subscriptions_active_per_tenant
  ON public.tenant_subscriptions(tenant_id)
  WHERE status IN ('trialing','active','past_due');

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant ON public.tenant_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_status ON public.tenant_subscriptions(status);

GRANT SELECT ON public.tenant_subscriptions TO authenticated;
GRANT ALL ON public.tenant_subscriptions TO service_role;

ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_subscriptions_select_member"
  ON public.tenant_subscriptions
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

DROP TRIGGER IF EXISTS trg_touch_tenant_subscriptions ON public.tenant_subscriptions;
CREATE TRIGGER trg_touch_tenant_subscriptions
  BEFORE UPDATE ON public.tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) Helper function
CREATE OR REPLACE FUNCTION public.has_active_subscription(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_subscriptions
    WHERE tenant_id = _tenant_id
      AND status IN ('trialing','active')
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;

REVOKE ALL ON FUNCTION public.has_active_subscription(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(UUID) TO authenticated, service_role;

-- 4) Seed default plans (idempotent)
INSERT INTO public.subscription_plans (name, description, price_monthly, max_users, max_products, features)
VALUES
  ('Free',  'Starter plan for a single cashier',        0,    2,   100,
   '{"reports": false, "backup": false, "multi_user": false}'::jsonb),
  ('Basic', 'Small shops with a few staff',             9.99, 5,   1000,
   '{"reports": true,  "backup": true,  "multi_user": true}'::jsonb),
  ('Pro',   'Growing businesses with advanced needs',  29.99, 25,  100000,
   '{"reports": true,  "backup": true,  "multi_user": true, "priority_support": true, "advanced_analytics": true}'::jsonb)
ON CONFLICT (name) DO NOTHING;
