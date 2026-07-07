
-- 1) Table
CREATE TABLE IF NOT EXISTS public.tenant_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_onboarding_step_chk CHECK (step IN (
    'account_created',
    'store_profile_completed',
    'first_product_added',
    'first_sale_completed',
    'onboarding_completed'
  )),
  CONSTRAINT tenant_onboarding_tenant_step_uniq UNIQUE (tenant_id, step)
);

-- 2) Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_onboarding TO authenticated;
GRANT ALL ON public.tenant_onboarding TO service_role;

-- 3) Indexes
CREATE INDEX IF NOT EXISTS idx_tenant_onboarding_tenant ON public.tenant_onboarding(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_onboarding_tenant_completed
  ON public.tenant_onboarding(tenant_id, completed);

-- 4) RLS
ALTER TABLE public.tenant_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_onboarding_select_member"
  ON public.tenant_onboarding
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "tenant_onboarding_insert_admin"
  ON public.tenant_onboarding
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role)
  );

CREATE POLICY "tenant_onboarding_update_admin"
  ON public.tenant_onboarding
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role))
  WITH CHECK (public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role));

CREATE POLICY "tenant_onboarding_delete_admin"
  ON public.tenant_onboarding
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role));

-- 5) updated_at trigger
DROP TRIGGER IF EXISTS trg_touch_tenant_onboarding ON public.tenant_onboarding;
CREATE TRIGGER trg_touch_tenant_onboarding
  BEFORE UPDATE ON public.tenant_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 6) Seeder function for new tenants
CREATE OR REPLACE FUNCTION public.seed_tenant_onboarding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.tenant_onboarding (tenant_id, step, completed)
  VALUES
    (NEW.id, 'account_created', true),
    (NEW.id, 'store_profile_completed', false),
    (NEW.id, 'first_product_added', false),
    (NEW.id, 'first_sale_completed', false),
    (NEW.id, 'onboarding_completed', false)
  ON CONFLICT (tenant_id, step) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seed_tenant_onboarding ON public.tenants;
CREATE TRIGGER trg_seed_tenant_onboarding
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.seed_tenant_onboarding();

-- 7) Backfill existing tenants as fully completed so current users are unaffected
INSERT INTO public.tenant_onboarding (tenant_id, step, completed)
SELECT t.id, s.step, true
FROM public.tenants t
CROSS JOIN (VALUES
  ('account_created'),
  ('store_profile_completed'),
  ('first_product_added'),
  ('first_sale_completed'),
  ('onboarding_completed')
) AS s(step)
ON CONFLICT (tenant_id, step) DO NOTHING;
