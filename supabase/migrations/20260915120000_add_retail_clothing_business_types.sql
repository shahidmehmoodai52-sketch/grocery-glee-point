-- Adds two more business types ("retail" and "clothing") to the set a shop
-- can pick at signup, alongside the existing "grocery" and "pharmacy".
-- Purely additive, same shape as the pharmacy business type added in
-- 20260911100000_pharmacy_business_type_tenants.sql / 20260911100800_
-- pharmacy_global_products_business_type_segregation.sql: widens the two
-- CHECK constraints and the two RPCs' validation lists. Existing tenants
-- and global_products rows are untouched (all currently 'grocery' or
-- 'pharmacy', both still allowed).
--
-- Both new types get the same generic (non-pharmacy) POS layout and
-- product fields that grocery already uses -- isPharmacy/useBusinessType()
-- checks throughout the app only special-case 'pharmacy', so no frontend
-- branching changes needed. Their product library starts empty (same as
-- pharmacy did on day one) since global_products segregates by
-- business_type and only grocery has contributed items so far.

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_business_type_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_business_type_check
  CHECK (business_type IN ('grocery', 'pharmacy', 'retail', 'clothing'));

ALTER TABLE public.global_products
  DROP CONSTRAINT IF EXISTS global_products_business_type_check;
ALTER TABLE public.global_products
  ADD CONSTRAINT global_products_business_type_check
  CHECK (business_type IN ('grocery', 'pharmacy', 'retail', 'clothing'));

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
  v_trial_plan_id uuid;
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
    -- Re-registration of an existing shop: business_type is intentionally
    -- left untouched here (it's a one-time setup choice, not editable via
    -- this path) — only contact/name details update.
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

  INSERT INTO public.tenants (name, owner_id, status, slug, metadata, plan, business_type)
  VALUES (
    btrim(_name),
    v_uid,
    'active',
    v_slug,
    jsonb_build_object('phone', _phone, 'address', _address, 'city', _city),
    'Pro',
    v_business_type
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

CREATE OR REPLACE FUNCTION public.admin_set_tenant_business_type(_tenant_id uuid, _business_type text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old text;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.manage') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  -- Kept in sync with tenants_business_type_check (see
  -- 20260915120000_add_retail_clothing_business_types.sql) -- a future
  -- business type needs both updated together.
  IF _business_type NOT IN ('grocery', 'pharmacy', 'retail', 'clothing') THEN
    RAISE EXCEPTION 'Invalid business type: %', _business_type;
  END IF;

  SELECT business_type INTO v_old FROM public.tenants WHERE id = _tenant_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Shop not found'; END IF;

  IF v_old IS DISTINCT FROM _business_type THEN
    UPDATE public.tenants SET business_type = _business_type, updated_at = now() WHERE id = _tenant_id;
    INSERT INTO public.audit_logs(tenant_id, user_id, action, table_name, record_id, old_data, new_data)
    VALUES (_tenant_id, auth.uid(), 'UPDATE', 'tenants', _tenant_id,
      jsonb_build_object('business_type', v_old),
      jsonb_build_object('business_type', _business_type, 'admin_action', 'tenant.business_type'));
  END IF;
END;
$function$;
