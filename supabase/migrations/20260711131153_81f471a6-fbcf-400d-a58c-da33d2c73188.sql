
-- 1) Fix existing memberships: owners must belong to their OWN tenant only
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id AS tenant_id, owner_id FROM public.tenants WHERE owner_id IS NOT NULL LOOP
    DELETE FROM public.tenant_members
      WHERE user_id = r.owner_id AND tenant_id <> r.tenant_id;
    INSERT INTO public.tenant_members(tenant_id, user_id, role)
      VALUES (r.tenant_id, r.owner_id, 'owner')
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner';
  END LOOP;
END $$;

-- 2) Patch register_shop: if the caller already has a membership in some OTHER
--    tenant (e.g. was pre-attached via staff panel) move them to their new one.
CREATE OR REPLACE FUNCTION public.register_shop(_name text, _phone text DEFAULT NULL, _address text DEFAULT NULL, _city text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _name IS NULL OR length(btrim(_name)) < 2 THEN RAISE EXCEPTION 'Shop name is required'; END IF;

  -- If the user already OWNS a tenant, ensure membership points to it and return.
  SELECT id INTO v_tid FROM public.tenants WHERE owner_id = v_uid LIMIT 1;
  IF v_tid IS NOT NULL THEN
    DELETE FROM public.tenant_members WHERE user_id = v_uid AND tenant_id <> v_tid;
    INSERT INTO public.tenant_members(tenant_id, user_id, role)
      VALUES (v_tid, v_uid, 'owner')
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner';
    RETURN v_tid;
  END IF;

  -- Create a brand-new tenant for this user
  INSERT INTO public.tenants(name, owner_id, status, metadata)
  VALUES (btrim(_name), v_uid, 'pending',
          jsonb_build_object('phone', _phone, 'address', _address, 'city', _city))
  RETURNING id INTO v_tid;

  -- Remove any prior memberships (e.g. Default Shop) and attach to own tenant
  DELETE FROM public.tenant_members WHERE user_id = v_uid;
  INSERT INTO public.tenant_members(tenant_id, user_id, role) VALUES (v_tid, v_uid, 'owner');

  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'admin') ON CONFLICT DO NOTHING;

  RETURN v_tid;
END;
$fn$;
