
-- 1) Ensure slug is populated for existing tenants
UPDATE public.tenants
SET slug = lower(substr(replace(id::text, '-', ''), 1, 8))
WHERE slug IS NULL OR slug = '';

-- 2) Helper: generate a unique short slug
CREATE OR REPLACE FUNCTION public.gen_tenant_slug(_seed text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_base text;
  v_try text;
  i int := 0;
BEGIN
  v_base := lower(regexp_replace(coalesce(_seed, ''), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  IF v_base = '' OR length(v_base) < 3 THEN
    v_base := 'shop-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  END IF;
  v_base := substr(v_base, 1, 20);
  v_try := v_base;
  LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_try);
    i := i + 1;
    v_try := v_base || '-' || lower(substr(md5(random()::text || i::text), 1, 4));
    IF i > 20 THEN
      v_try := 'shop-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
      EXIT;
    END IF;
  END LOOP;
  RETURN v_try;
END $$;

-- 3) Get current user's shop code
CREATE OR REPLACE FUNCTION public.get_my_shop_code()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT slug FROM public.tenants WHERE id = public.current_tenant_id();
$$;

-- 4) Public lookup for shop code -> tenant_id (for login screen)
CREATE OR REPLACE FUNCTION public.get_tenant_id_by_code(_code text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.tenants WHERE slug = lower(trim(_code)) LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_shop_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_id_by_code(text) TO anon, authenticated;

-- 5) Patch register_shop to always set slug
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- If caller already owns a tenant, use it (fix orphan memberships)
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

  -- Wipe any stray memberships and put user in their new shop only
  DELETE FROM public.tenant_members WHERE user_id = v_uid;
  INSERT INTO public.tenant_members (tenant_id, user_id, role)
  VALUES (v_tid, v_uid, 'owner');

  -- Store basic contact info in store_settings if columns exist
  UPDATE public.store_settings
     SET store_phone = COALESCE(_phone, store_phone),
         store_address = COALESCE(_address, store_address),
         store_city = COALESCE(_city, store_city)
   WHERE tenant_id = v_tid;

  RETURN v_tid;
END $$;
