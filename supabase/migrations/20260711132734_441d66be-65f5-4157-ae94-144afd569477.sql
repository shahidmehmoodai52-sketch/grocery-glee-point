
CREATE OR REPLACE FUNCTION public.register_shop(
  _name text,
  _phone text DEFAULT NULL,
  _address text DEFAULT NULL,
  _city text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tid uuid;
  v_owned uuid;
  v_slug text;
  v_addr text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT id INTO v_owned FROM public.tenants WHERE owner_id = v_uid LIMIT 1;
  IF v_owned IS NOT NULL THEN
    DELETE FROM public.tenant_members WHERE user_id = v_uid AND tenant_id <> v_owned;
    INSERT INTO public.tenant_members (tenant_id, user_id, role)
      VALUES (v_owned, v_uid, 'owner') ON CONFLICT DO NOTHING;
    IF (SELECT slug FROM public.tenants WHERE id = v_owned) IS NULL THEN
      UPDATE public.tenants SET slug = public.gen_tenant_slug(_name) WHERE id = v_owned;
    END IF;
    RETURN v_owned;
  END IF;

  v_slug := public.gen_tenant_slug(_name);
  INSERT INTO public.tenants (name, owner_id, status, slug)
  VALUES (_name, v_uid, 'pending', v_slug)
  RETURNING id INTO v_tid;

  DELETE FROM public.tenant_members WHERE user_id = v_uid;
  INSERT INTO public.tenant_members (tenant_id, user_id, role)
  VALUES (v_tid, v_uid, 'owner');

  v_addr := NULLIF(trim(concat_ws(', ', NULLIF(_address, ''), NULLIF(_city, ''))), '');
  UPDATE public.store_settings
     SET phone = COALESCE(_phone, phone),
         address = COALESCE(v_addr, address)
   WHERE tenant_id = v_tid;

  RETURN v_tid;
END $$;
