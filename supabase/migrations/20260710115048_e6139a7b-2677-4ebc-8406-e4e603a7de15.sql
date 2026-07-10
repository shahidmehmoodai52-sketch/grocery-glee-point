CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_count      int;
  v_tenant_id       uuid;
  v_is_anonymous    boolean := COALESCE(NEW.is_anonymous, false);
  v_email           text := lower(COALESCE(NEW.email, ''));
  v_full_name       text := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.email, ''),
    'Guest User'
  );
  v_tenant_name     text := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'tenant_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'business_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(split_part(COALESCE(NEW.email,''), '@', 1), ''),
    'New'
  ) || '''s Shop';
  v_has_invitation  boolean := false;
  v_new_status      text := 'pending';
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, v_full_name)
  ON CONFLICT (id) DO NOTHING;

  SELECT COUNT(*) INTO v_user_count FROM auth.users;
  IF v_user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
    v_new_status := 'active';
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'cashier') ON CONFLICT DO NOTHING;
  END IF;

  -- Anonymous (guest) users register their shop later via register_shop RPC.
  IF v_is_anonymous THEN
    RETURN NEW;
  END IF;

  IF v_email <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_invitations
      WHERE lower(email) = v_email AND accepted_at IS NULL AND expires_at > now()
    ) INTO v_has_invitation;
  END IF;
  IF v_has_invitation THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_members WHERE user_id = NEW.id) THEN RETURN NEW; END IF;

  INSERT INTO public.tenants (name, owner_id, status)
  VALUES (v_tenant_name, NEW.id, v_new_status)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_members (tenant_id, user_id, role)
  VALUES (v_tenant_id, NEW.id, 'owner')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $function$;