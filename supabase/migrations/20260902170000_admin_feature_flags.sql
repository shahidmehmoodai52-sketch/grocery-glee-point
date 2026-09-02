-- Phase E: Feature flag registry.
--
-- subscription_plans.features (jsonb) already carries real, populated
-- plan-level flags (backup, multi_user, reports, advanced_analytics,
-- priority_support across the Free/Basic/Pro/Unlimited plans) but is read
-- by zero frontend code today and has no tenant-level override mechanism
-- and no admin UI. This migration adds only the genuinely missing pieces:
-- a canonical flag registry (name/description/default, for the "global
-- flag" layer) and a tenant-level override table -- it deliberately REUSES
-- subscription_plans.features as the plan-level layer rather than
-- duplicating it into a second table. The registry is seeded with exactly
-- the 5 keys already found in subscription_plans.features -- no new,
-- speculative flags are invented.

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key              text PRIMARY KEY,
  label            text NOT NULL,
  description      text,
  default_enabled  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.feature_flags (key, label, description, default_enabled) VALUES
  ('backup', 'Backups', 'Automatic/manual data backup for the shop.', false),
  ('multi_user', 'Multiple users', 'Allow more than one staff login for the shop.', false),
  ('reports', 'Reports', 'Access to the reporting/analytics pages.', true),
  ('advanced_analytics', 'Advanced analytics', 'Deeper sales/inventory analytics beyond basic reports.', false),
  ('priority_support', 'Priority support', 'Priority handling for this shop''s support requests.', false)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tenant_feature_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  flag_key    text NOT NULL REFERENCES public.feature_flags(key) ON DELETE CASCADE,
  enabled     boolean NOT NULL,
  updated_by  uuid REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, flag_key)
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_feature_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_staff_view_feature_flags ON public.feature_flags;
CREATE POLICY admin_staff_view_feature_flags ON public.feature_flags
  FOR SELECT TO authenticated USING (public.am_i_admin_staff());

DROP POLICY IF EXISTS admin_staff_view_tenant_feature_overrides ON public.tenant_feature_overrides;
CREATE POLICY admin_staff_view_tenant_feature_overrides ON public.tenant_feature_overrides
  FOR SELECT TO authenticated USING (public.am_i_admin_staff());
-- No INSERT/UPDATE/DELETE policies on either table: writes only via the
-- SECURITY DEFINER RPC below, matching admin_action_log's convention.

-- Effective resolution order for a given tenant+flag: tenant override (if
-- any) > the tenant's plan's subscription_plans.features entry (if
-- present) > the registry's own default_enabled. Available for any future
-- server-side gate to call; existing app features are not retrofitted to
-- call it in this pass (that would be an unrelated business-logic change
-- outside the admin panel), so this resolves the flag honestly without
-- claiming enforcement it does not yet perform.
CREATE OR REPLACE FUNCTION public.resolve_feature_flag(_tenant_id uuid, _flag_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_override boolean;
  v_plan_value jsonb;
  v_default boolean;
BEGIN
  SELECT enabled INTO v_override FROM public.tenant_feature_overrides
    WHERE tenant_id = _tenant_id AND flag_key = _flag_key;
  IF v_override IS NOT NULL THEN RETURN v_override; END IF;

  SELECT sp.features -> _flag_key INTO v_plan_value
    FROM public.tenant_subscriptions ts
    JOIN public.subscription_plans sp ON sp.id = ts.plan_id
    WHERE ts.tenant_id = _tenant_id AND ts.status = 'active'
    ORDER BY ts.started_at DESC LIMIT 1;
  IF v_plan_value IS NOT NULL THEN RETURN (v_plan_value)::boolean; END IF;

  SELECT default_enabled INTO v_default FROM public.feature_flags WHERE key = _flag_key;
  RETURN COALESCE(v_default, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_feature_flag(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_feature_flag(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_feature_flags()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'key', f.key,
    'label', f.label,
    'description', f.description,
    'default_enabled', f.default_enabled,
    'plan_states', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('plan_name', sp.name, 'enabled', (sp.features -> f.key)::boolean))
      FROM public.subscription_plans sp
      WHERE sp.active AND sp.features ? f.key
    ), '[]'::jsonb),
    'tenant_overrides', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'tenant_id', t.id, 'tenant_name', t.name, 'enabled', o.enabled, 'updated_at', o.updated_at
      ) ORDER BY o.updated_at DESC)
      FROM public.tenant_feature_overrides o
      JOIN public.tenants t ON t.id = o.tenant_id
      WHERE o.flag_key = f.key
    ), '[]'::jsonb)
  ) ORDER BY f.label) INTO v_out
  FROM public.feature_flags f;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_feature_flags() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_feature_flags() TO authenticated;

-- Tenant-level overrides change what a tenant is entitled to (the same
-- category of action as assigning a plan), so this reuses 'shops.manage'
-- -- the existing permission key the legacy admin_set_tenant_plan(text)
-- RPC already requires for that same class of change -- rather than
-- inventing a new key.
CREATE OR REPLACE FUNCTION public.admin_set_tenant_feature_override(
  _tenant_id uuid, _flag_key text, _enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.manage') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE key = _flag_key) THEN
    RAISE EXCEPTION 'Unknown feature flag: %', _flag_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant_id) THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  INSERT INTO public.tenant_feature_overrides (tenant_id, flag_key, enabled, updated_by, updated_at)
  VALUES (_tenant_id, _flag_key, _enabled, auth.uid(), now())
  ON CONFLICT (tenant_id, flag_key)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now();

  PERFORM public.log_admin_action(
    'FEATURE_FLAG_OVERRIDE_SET', _tenant_id, 'feature_flag', _flag_key, NULL,
    NULL, jsonb_build_object('flag_key', _flag_key, 'enabled', _enabled)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_tenant_feature_override(uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_feature_override(uuid, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_clear_tenant_feature_override(_tenant_id uuid, _flag_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.manage') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  DELETE FROM public.tenant_feature_overrides WHERE tenant_id = _tenant_id AND flag_key = _flag_key;

  PERFORM public.log_admin_action(
    'FEATURE_FLAG_OVERRIDE_CLEAR', _tenant_id, 'feature_flag', _flag_key, NULL,
    NULL, NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_clear_tenant_feature_override(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_tenant_feature_override(uuid, text) TO authenticated;
