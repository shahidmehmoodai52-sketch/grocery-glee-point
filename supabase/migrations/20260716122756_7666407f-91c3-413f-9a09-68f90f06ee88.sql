
CREATE OR REPLACE FUNCTION public.enforce_user_roles_guardrails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_bypass text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  BEGIN
    v_bypass := current_setting('app.bypass_role_guard', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;
  IF v_bypass = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.user_id = v_actor THEN
    RAISE EXCEPTION 'You cannot modify your own role assignments';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.user_id = v_actor THEN
    RAISE EXCEPTION 'You cannot modify your own role assignments';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;

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

  INSERT INTO public.tenants (name, owner_id, status, slug, metadata)
  VALUES (
    btrim(_name),
    v_uid,
    'pending',
    v_slug,
    jsonb_build_object('phone', _phone, 'address', _address, 'city', _city)
  )
  RETURNING id INTO v_tid;

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
