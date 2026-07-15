CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_count int;
  v_is_anonymous boolean := COALESCE(NEW.is_anonymous, false);
  v_full_name text := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.email, ''),
    'Guest User'
  );
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, v_full_name)
  ON CONFLICT (id) DO NOTHING;

  SELECT COUNT(*) INTO v_user_count FROM auth.users;
  IF v_user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT DO NOTHING;
  ELSIF NOT v_is_anonymous THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'cashier'::public.app_role)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Shops must only be created by the explicit register_shop flow, where
  -- the user-entered shop name, phone, address, and city are available.
  RETURN NEW;
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

WITH orphan_shops AS (
  SELECT id
  FROM public.tenants
  WHERE owner_id IS NULL
    AND status = 'pending'
    AND (
      name ILIKE 'diag%''s Shop'
      OR name ILIKE 'testc%''s Shop'
    )
)
DELETE FROM public.store_settings ss
USING orphan_shops os
WHERE ss.tenant_id = os.id;

DELETE FROM public.tenants
WHERE owner_id IS NULL
  AND status = 'pending'
  AND (
    name ILIKE 'diag%''s Shop'
    OR name ILIKE 'testc%''s Shop'
  );