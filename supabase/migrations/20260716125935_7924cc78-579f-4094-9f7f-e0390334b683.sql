
-- Return 'expired' when latest subscription is past expires_at (unless super_admin/suspended/archived/pending take precedence)
CREATE OR REPLACE FUNCTION public.my_tenant_status()
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_status text;
  v_exp timestamptz;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT status INTO v_status FROM public.tenants WHERE id = v_tenant;
  IF v_status IN ('suspended','archived','pending') THEN
    RETURN v_status;
  END IF;
  SELECT expires_at INTO v_exp
    FROM public.tenant_subscriptions
   WHERE tenant_id = v_tenant
   ORDER BY started_at DESC
   LIMIT 1;
  IF v_exp IS NOT NULL AND v_exp < now() THEN
    RETURN 'expired';
  END IF;
  RETURN v_status;
END $$;

-- Quick setter for expiry (super admin only) — creates a sub if none exists
CREATE OR REPLACE FUNCTION public.admin_set_tenant_expiry(_tenant_id uuid, _expires_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_sub_id uuid; v_plan_id uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT id INTO v_sub_id FROM public.tenant_subscriptions
    WHERE tenant_id = _tenant_id
    ORDER BY started_at DESC LIMIT 1;

  IF v_sub_id IS NULL THEN
    SELECT id INTO v_plan_id FROM public.subscription_plans WHERE active = true ORDER BY price_monthly LIMIT 1;
    IF v_plan_id IS NULL THEN RAISE EXCEPTION 'No subscription plan available'; END IF;
    INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, started_at, expires_at)
    VALUES (_tenant_id, v_plan_id, 'active', now(), _expires_at);
  ELSE
    UPDATE public.tenant_subscriptions
       SET expires_at = _expires_at,
           status = CASE WHEN _expires_at IS NULL OR _expires_at > now() THEN 'active' ELSE status END,
           updated_at = now()
     WHERE id = v_sub_id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_set_tenant_expiry(uuid, timestamptz) TO authenticated;
