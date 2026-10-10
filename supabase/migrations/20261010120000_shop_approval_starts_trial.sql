-- New shops need platform approval again; the 7-day trial starts on approval.
--
-- register_shop() created every new shop as 'active' with a 7-day trial
-- straight away. Shops now start 'pending' (the app shows a "waiting for
-- approval" screen and /download refuses the installer) and get no
-- subscription row. When an admin approves (admin_set_tenant_status ->
-- 'active') a shop that has never had a subscription, its 7-day trial starts
-- at that moment, so the clock doesn't run while it waits for review.
-- Existing shops are untouched.

CREATE OR REPLACE FUNCTION public.register_shop(_name text, _phone text DEFAULT NULL::text, _address text DEFAULT NULL::text, _city text DEFAULT NULL::text, _business_type text DEFAULT 'grocery'::text)
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
  v_business_type text := COALESCE(NULLIF(btrim(_business_type), ''), 'grocery');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _name IS NULL OR length(btrim(_name)) < 2 THEN RAISE EXCEPTION 'Shop name is required'; END IF;
  IF v_business_type NOT IN ('grocery', 'pharmacy', 'retail', 'clothing') THEN
    RAISE EXCEPTION 'Unsupported business type: %', v_business_type;
  END IF;

  PERFORM set_config('app.bypass_role_guard', 'on', true);
  v_addr := NULLIF(trim(concat_ws(', ', NULLIF(_address, ''), NULLIF(_city, ''))), '');
  v_slug := public.gen_tenant_slug(_name);

  SELECT id INTO v_owned FROM public.tenants WHERE owner_id = v_uid LIMIT 1;
  IF v_owned IS NOT NULL THEN
    DELETE FROM public.tenant_members WHERE user_id = v_uid AND tenant_id <> v_owned;
    INSERT INTO public.tenant_members (tenant_id, user_id, role)
      VALUES (v_owned, v_uid, 'owner') ON CONFLICT DO NOTHING;
    UPDATE public.tenants
       SET name = btrim(_name), slug = COALESCE(slug, v_slug),
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('phone', _phone, 'address', _address, 'city', _city),
           updated_at = now()
     WHERE id = v_owned;
    UPDATE public.store_settings SET phone = COALESCE(_phone, phone), address = COALESCE(v_addr, address)
     WHERE tenant_id = v_owned;
    INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'admin'::public.app_role) ON CONFLICT DO NOTHING;
    DELETE FROM public.user_roles WHERE user_id = v_uid AND role = 'cashier'::public.app_role
      AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role = 'admin'::public.app_role);
    RETURN v_owned;
  END IF;

  -- 'pending' until an admin approves it; no trial yet (see admin_set_tenant_status).
  INSERT INTO public.tenants (name, owner_id, status, slug, metadata, plan, business_type, library_approved)
  VALUES (btrim(_name), v_uid, 'pending', v_slug,
          jsonb_build_object('phone', _phone, 'address', _address, 'city', _city),
          'Pro', v_business_type, false)
  RETURNING id INTO v_tid;

  DELETE FROM public.tenant_members WHERE user_id = v_uid;
  INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES (v_tid, v_uid, 'owner');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'admin'::public.app_role) ON CONFLICT DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = v_uid AND role = 'cashier'::public.app_role
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role = 'admin'::public.app_role);

  UPDATE public.store_settings SET phone = COALESCE(_phone, phone), address = COALESCE(v_addr, address)
   WHERE tenant_id = v_tid;

  RETURN v_tid;
END $function$;

-- The old 4-argument overload: same rule, defaults to grocery.
CREATE OR REPLACE FUNCTION public.register_shop(_name text, _phone text DEFAULT NULL::text, _address text DEFAULT NULL::text, _city text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.register_shop(_name, _phone, _address, _city, 'grocery'::text);
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_tenant_status(_tenant_id uuid, _status text, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _old_status text;
  _trial_plan_id uuid;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.approve') AND NOT public.admin_has_perm(auth.uid(), 'shops.suspend') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT status INTO _old_status FROM public.tenants WHERE id = _tenant_id;

  UPDATE public.tenants
  SET status = _status,
      updated_at = now()
  WHERE id = _tenant_id;

  -- Approval of a shop that has never had a subscription starts its 7-day
  -- trial now. Re-activating a suspended shop doesn't touch its plan.
  IF _status = 'active' AND _old_status = 'pending'
     AND NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id) THEN
    SELECT id INTO _trial_plan_id FROM public.subscription_plans WHERE name = 'Pro' LIMIT 1;
    IF _trial_plan_id IS NOT NULL THEN
      INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, started_at, expires_at)
      VALUES (_tenant_id, _trial_plan_id, 'trialing', now(), now() + interval '7 days');
    END IF;
  END IF;

  PERFORM public.log_admin_action(
    'TENANT_SET_STATUS',
    _tenant_id,
    'tenant',
    _tenant_id::text,
    _reason,
    jsonb_build_object('status', _old_status),
    jsonb_build_object('status', _status)
  );
END;
$function$;
