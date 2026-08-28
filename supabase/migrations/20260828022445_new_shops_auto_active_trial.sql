-- New shops get instant, full access via a 7-day trial instead of sitting in
-- 'pending' status until a human manually approves them — matches the
-- landing page's "7-day free trial, no credit card required" promise and
-- doesn't bottleneck growth on manual review. Admins can still suspend an
-- individual shop after the fact (admin_set_tenant_status) if needed.
CREATE OR REPLACE FUNCTION public.register_shop(_name text, _phone text DEFAULT NULL::text, _address text DEFAULT NULL::text, _city text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tid uuid;
  v_owned uuid;
  v_slug text;
  v_addr text;
  v_trial_plan_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _name IS NULL OR length(btrim(_name)) < 2 THEN RAISE EXCEPTION 'Shop name is required'; END IF;

  PERFORM set_config('app.bypass_role_guard', 'on', true);

  v_addr := NULLIF(trim(concat_ws(', ', NULLIF(_address, ''), NULLIF(_city, ''))), '');
  v_slug := public.gen_tenant_slug(_name);

  SELECT id INTO v_owned FROM public.tenants WHERE owner_id = v_uid LIMIT 1;
  IF v_owned IS NOT NULL THEN
    DELETE FROM public.tenant_members WHERE user_id = v_uid AND tenant_id <> v_owned;
    INSERT INTO public.tenant_members (tenant_id, user_id, role)
      VALUES (v_owned, v_uid, 'owner') ON CONFLICT DO NOTHING;
    UPDATE public.tenants
       SET name = btrim(_name),
           slug = COALESCE(slug, v_slug),
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('phone', _phone, 'address', _address, 'city', _city),
           updated_at = now()
     WHERE id = v_owned;
    UPDATE public.store_settings
       SET phone = COALESCE(_phone, phone),
           address = COALESCE(v_addr, address)
     WHERE tenant_id = v_owned;
    INSERT INTO public.user_roles (user_id, role)
      VALUES (v_uid, 'admin'::public.app_role)
      ON CONFLICT DO NOTHING;
    DELETE FROM public.user_roles
      WHERE user_id = v_uid
        AND role = 'cashier'::public.app_role
        AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = v_uid AND ur.role = 'admin'::public.app_role
        );
    RETURN v_owned;
  END IF;

  SELECT id INTO v_trial_plan_id FROM public.subscription_plans WHERE name = 'Pro' LIMIT 1;

  INSERT INTO public.tenants (name, owner_id, status, slug, metadata, plan)
  VALUES (
    btrim(_name),
    v_uid,
    'active',
    v_slug,
    jsonb_build_object('phone', _phone, 'address', _address, 'city', _city),
    'Pro'
  )
  RETURNING id INTO v_tid;

  IF v_trial_plan_id IS NOT NULL THEN
    INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, started_at, expires_at)
    VALUES (v_tid, v_trial_plan_id, 'trialing', now(), now() + interval '7 days');
  END IF;

  DELETE FROM public.tenant_members WHERE user_id = v_uid;
  INSERT INTO public.tenant_members (tenant_id, user_id, role)
  VALUES (v_tid, v_uid, 'owner');

  INSERT INTO public.user_roles (user_id, role)
    VALUES (v_uid, 'admin'::public.app_role)
    ON CONFLICT DO NOTHING;
  DELETE FROM public.user_roles
    WHERE user_id = v_uid
      AND role = 'cashier'::public.app_role
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = v_uid AND ur.role = 'admin'::public.app_role
      );

  UPDATE public.store_settings
     SET phone = COALESCE(_phone, phone),
         address = COALESCE(v_addr, address)
   WHERE tenant_id = v_tid;

  RETURN v_tid;
END $function$;
