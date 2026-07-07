
-- ─────────────────────────────────────────────────────────────
-- Helper: active plan for a tenant (NULL when none/expired)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.active_plan_for_tenant(_tenant_id UUID)
RETURNS public.subscription_plans
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.tenant_subscriptions s
  JOIN public.subscription_plans p ON p.id = s.plan_id
  WHERE s.tenant_id = _tenant_id
    AND s.status IN ('trialing','active')
    AND (s.expires_at IS NULL OR s.expires_at > now())
  ORDER BY s.started_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.active_plan_for_tenant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.active_plan_for_tenant(UUID) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- Guards
-- Grandfather rule: tenants with NO active subscription row are
-- treated as unlimited so pre-existing users are not affected.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_add_product(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.subscription_plans;
  v_count INTEGER;
BEGIN
  IF _tenant_id IS NULL THEN RETURN TRUE; END IF;
  v_plan := public.active_plan_for_tenant(_tenant_id);
  IF v_plan IS NULL OR v_plan.max_products IS NULL THEN
    RETURN TRUE; -- unlimited / grandfathered
  END IF;
  SELECT COUNT(*) INTO v_count
    FROM public.products
    WHERE tenant_id = _tenant_id AND COALESCE(is_active, TRUE) = TRUE;
  RETURN v_count < v_plan.max_products;
END $$;

CREATE OR REPLACE FUNCTION public.can_add_user(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.subscription_plans;
  v_count INTEGER;
BEGIN
  IF _tenant_id IS NULL THEN RETURN TRUE; END IF;
  v_plan := public.active_plan_for_tenant(_tenant_id);
  IF v_plan IS NULL OR v_plan.max_users IS NULL THEN
    RETURN TRUE;
  END IF;
  SELECT COUNT(*) INTO v_count
    FROM public.tenant_members
    WHERE tenant_id = _tenant_id;
  RETURN v_count < v_plan.max_users;
END $$;

CREATE OR REPLACE FUNCTION public.has_feature_access(_tenant_id UUID, _feature TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.subscription_plans;
  v_val JSONB;
BEGIN
  IF _tenant_id IS NULL OR _feature IS NULL THEN RETURN TRUE; END IF;
  v_plan := public.active_plan_for_tenant(_tenant_id);
  IF v_plan IS NULL THEN
    RETURN TRUE; -- grandfathered
  END IF;
  v_val := v_plan.features -> _feature;
  IF v_val IS NULL THEN
    RETURN TRUE; -- undefined feature => allow
  END IF;
  RETURN COALESCE((v_val)::text::boolean, FALSE);
END $$;

REVOKE ALL ON FUNCTION public.can_add_product(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_add_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_feature_access(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_add_product(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_add_user(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_feature_access(UUID, TEXT) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- Enforcement triggers (backend, not just UI)
-- Service role bypasses so admin/backfill jobs keep working.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_product_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS NOT NULL AND NOT public.can_add_product(NEW.tenant_id) THEN
    RAISE EXCEPTION 'Product limit reached for your current plan. Please upgrade to add more products.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_product_limit ON public.products;
CREATE TRIGGER trg_enforce_product_limit
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_product_limit();

CREATE OR REPLACE FUNCTION public.enforce_user_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS NOT NULL AND NOT public.can_add_user(NEW.tenant_id) THEN
    RAISE EXCEPTION 'User limit reached for your current plan. Please upgrade to add more team members.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_user_limit ON public.tenant_members;
CREATE TRIGGER trg_enforce_user_limit
  BEFORE INSERT ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_limit();
