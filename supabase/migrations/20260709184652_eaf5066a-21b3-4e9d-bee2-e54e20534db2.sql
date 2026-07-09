
CREATE OR REPLACE FUNCTION public.register_shop(
  _name text,
  _phone text DEFAULT NULL,
  _address text DEFAULT NULL,
  _city text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tid uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) < 2 THEN
    RAISE EXCEPTION 'Shop name is required';
  END IF;

  -- If the user already owns / belongs to a tenant, just return it (idempotent).
  SELECT id INTO v_tid FROM public.tenants WHERE owner_id = v_uid LIMIT 1;
  IF v_tid IS NOT NULL THEN
    RETURN v_tid;
  END IF;
  SELECT tenant_id INTO v_tid FROM public.tenant_members WHERE user_id = v_uid LIMIT 1;
  IF v_tid IS NOT NULL THEN
    RETURN v_tid;
  END IF;

  INSERT INTO public.tenants(name, owner_id, status, metadata)
  VALUES (
    btrim(_name),
    v_uid,
    'pending',
    jsonb_build_object('phone', _phone, 'address', _address, 'city', _city)
  )
  RETURNING id INTO v_tid;

  INSERT INTO public.tenant_members(tenant_id, user_id, role)
  VALUES (v_tid, v_uid, 'owner')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_roles(user_id, role)
  VALUES (v_uid, 'admin')
  ON CONFLICT DO NOTHING;

  RETURN v_tid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_shop(text, text, text, text) TO authenticated;
