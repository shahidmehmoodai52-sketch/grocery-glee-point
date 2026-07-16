CREATE OR REPLACE FUNCTION public.shop_owner_finalize_staff(
  _staff_user_id uuid,
  _username text,
  _role public.app_role,
  _perms text[] DEFAULT ARRAY[]::text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_clean_username text;
  v_member_role public.tenant_role;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF _staff_user_id IS NULL OR _staff_user_id = v_actor THEN
    RAISE EXCEPTION 'Invalid staff account';
  END IF;

  v_clean_username := lower(regexp_replace(btrim(COALESCE(_username, '')), '[^a-z0-9._-]', '', 'g'));
  IF length(v_clean_username) < 2 THEN
    RAISE EXCEPTION 'Username must be 2+ chars (letters, numbers, . _ -)';
  END IF;

  IF _role NOT IN ('admin'::public.app_role, 'cashier'::public.app_role) THEN
    RAISE EXCEPTION 'Invalid staff role';
  END IF;

  SELECT id INTO v_tenant
  FROM public.tenants
  WHERE owner_id = v_actor
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Only the shop owner can manage staff';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    JOIN public.profiles p ON p.id = tm.user_id
    WHERE tm.tenant_id = v_tenant
      AND tm.user_id <> _staff_user_id
      AND lower(COALESCE(p.full_name, '')) = v_clean_username
  ) THEN
    RAISE EXCEPTION 'Username already exists in this shop';
  END IF;

  PERFORM set_config('app.bypass_role_guard', 'on', true);

  UPDATE public.profiles
     SET full_name = v_clean_username
   WHERE id = _staff_user_id;

  DELETE FROM public.user_roles WHERE user_id = _staff_user_id;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_staff_user_id, _role)
  ON CONFLICT DO NOTHING;

  DELETE FROM public.user_permissions WHERE user_id = _staff_user_id;
  IF _role = 'cashier'::public.app_role AND COALESCE(array_length(_perms, 1), 0) > 0 THEN
    INSERT INTO public.user_permissions (user_id, perm, granted_by)
    SELECT _staff_user_id, p, v_actor
    FROM unnest(_perms) AS p
    WHERE p IS NOT NULL AND btrim(p) <> ''
    ON CONFLICT (user_id, perm) DO UPDATE
      SET granted_by = EXCLUDED.granted_by,
          granted_at = now();
  END IF;

  DELETE FROM public.tenant_members WHERE user_id = _staff_user_id;
  v_member_role := CASE WHEN _role = 'admin'::public.app_role THEN 'admin'::public.tenant_role ELSE 'cashier'::public.tenant_role END;
  INSERT INTO public.tenant_members (tenant_id, user_id, role, invited_by)
  VALUES (v_tenant, _staff_user_id, v_member_role, v_actor)
  ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        invited_by = EXCLUDED.invited_by,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.shop_owner_finalize_staff(uuid, text, public.app_role, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_owner_finalize_staff(uuid, text, public.app_role, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.shop_owner_set_staff_access(
  _staff_user_id uuid,
  _role public.app_role,
  _perms text[] DEFAULT ARRAY[]::text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_member_role public.tenant_role;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF _staff_user_id IS NULL OR _staff_user_id = v_actor THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;

  IF _role NOT IN ('admin'::public.app_role, 'cashier'::public.app_role) THEN
    RAISE EXCEPTION 'Invalid staff role';
  END IF;

  SELECT id INTO v_tenant
  FROM public.tenants
  WHERE owner_id = v_actor
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Only the shop owner can manage staff';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = v_tenant AND user_id = _staff_user_id
  ) THEN
    RAISE EXCEPTION 'This user is not part of your shop';
  END IF;

  PERFORM set_config('app.bypass_role_guard', 'on', true);

  DELETE FROM public.user_roles WHERE user_id = _staff_user_id;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_staff_user_id, _role)
  ON CONFLICT DO NOTHING;

  DELETE FROM public.user_permissions WHERE user_id = _staff_user_id;
  IF _role = 'cashier'::public.app_role AND COALESCE(array_length(_perms, 1), 0) > 0 THEN
    INSERT INTO public.user_permissions (user_id, perm, granted_by)
    SELECT _staff_user_id, p, v_actor
    FROM unnest(_perms) AS p
    WHERE p IS NOT NULL AND btrim(p) <> ''
    ON CONFLICT (user_id, perm) DO UPDATE
      SET granted_by = EXCLUDED.granted_by,
          granted_at = now();
  END IF;

  v_member_role := CASE WHEN _role = 'admin'::public.app_role THEN 'admin'::public.tenant_role ELSE 'cashier'::public.tenant_role END;
  UPDATE public.tenant_members
     SET role = v_member_role,
         updated_at = now()
   WHERE tenant_id = v_tenant
     AND user_id = _staff_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.shop_owner_set_staff_access(uuid, public.app_role, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_owner_set_staff_access(uuid, public.app_role, text[]) TO authenticated;