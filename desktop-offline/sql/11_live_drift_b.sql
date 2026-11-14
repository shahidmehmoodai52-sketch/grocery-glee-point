-- Live definitions (pg_get_functiondef) that differ from what the repo
-- migrations produce. Batch B: signup, shop registration, sale-time triggers.
-- NOTE: register_shop starts a 7-day 'trialing' subscription exactly as live
-- does; the offline license (phase 2) replaces that expiry.

DROP FUNCTION IF EXISTS public.auto_grant_developer_super_admin() CASCADE;  -- dropped on live
DROP FUNCTION IF EXISTS public.cleanup_old_audit_logs(integer, integer);   -- dropped on live

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_anonymous boolean := COALESCE(NEW.is_anonymous, false);
  v_full_name text := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.email, ''),
    'Guest User'
  );
  v_admin_exists boolean;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, v_full_name)
  ON CONFLICT (id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE role::text IN ('admin','super_admin')
  ) INTO v_admin_exists;

  IF NOT v_admin_exists THEN
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
END $function$
;

CREATE OR REPLACE FUNCTION public.record_inventory_movement(_tenant_id uuid, _product_id uuid, _movement_type inventory_movement_type, _reference_type inventory_reference_type, _reference_id uuid, _reference_no text, _qty_change numeric, _unit_cost numeric, _user_id uuid, _customer_id uuid, _supplier_id uuid, _reason text, _note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_current NUMERIC;
  v_before NUMERIC;
  v_after NUMERIC;
  v_uid uuid := auth.uid();
BEGIN
  IF _product_id IS NULL OR _tenant_id IS NULL OR _qty_change IS NULL THEN
    RETURN NULL;
  END IF;

  -- Caller must belong to the tenant they're writing into, and the product
  -- must actually be that tenant's — otherwise this becomes a way to inject
  -- fabricated stock-movement rows into another shop's history.
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm WHERE tm.user_id = v_uid AND tm.tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'User is not a member of this tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = _product_id AND p.tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'Product does not belong to this tenant';
  END IF;

  -- Item-level triggers fire AFTER item INSERT but BEFORE the RPC updates products.stock,
  -- so the "current" read reflects the pre-change stock (= stock_before).
  SELECT COALESCE(stock, 0) INTO v_current FROM public.products WHERE id = _product_id;
  v_before := COALESCE(v_current, 0);
  v_after  := v_before + COALESCE(_qty_change, 0);

  INSERT INTO public.inventory_movements (
    tenant_id, product_id, movement_type, reference_type, reference_id, reference_no,
    qty_change, stock_before, stock_after, unit_cost, total_cost,
    user_id, customer_id, supplier_id, reason, note
  ) VALUES (
    _tenant_id, _product_id, _movement_type, _reference_type, _reference_id, _reference_no,
    _qty_change, v_before, v_after,
    _unit_cost,
    CASE WHEN _unit_cost IS NULL THEN NULL ELSE ROUND((_unit_cost * ABS(_qty_change))::numeric, 4) END,
    _user_id, _customer_id, _supplier_id, _reason, _note
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.record_sync_tombstones()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.sync_tombstones (tenant_id, table_name, row_id)
  SELECT o.tenant_id, TG_TABLE_NAME, o.id
    FROM old_rows o
   WHERE o.tenant_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = o.tenant_id);
  RETURN NULL;
END
$function$
;

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
  v_trial_plan_id uuid;
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

  -- New shops get instant, full access via a 7-day trial instead of sitting in
  -- 'pending' status until a human manually approves them — matches the
  -- landing page's "7-day free trial, no credit card required" promise and
  -- doesn't bottleneck growth on manual review. Admins can still suspend an
  -- individual shop after the fact (admin_set_tenant_status) if needed.
  SELECT id INTO v_trial_plan_id FROM public.subscription_plans WHERE name = 'Pro' LIMIT 1;

  INSERT INTO public.tenants (name, owner_id, status, slug, metadata, plan)
  VALUES (
    btrim(_name),
    v_uid,
    'active',
    v_slug,
    jsonb_build_object('phone', _phone, 'address', _address, 'city', _city),
    'Pro'
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
END $function$
;

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

  SELECT id INTO v_trial_plan_id FROM public.subscription_plans WHERE name = 'Pro' LIMIT 1;

  INSERT INTO public.tenants (name, owner_id, status, slug, metadata, plan, business_type, library_approved)
  VALUES (btrim(_name), v_uid, 'active', v_slug,
          jsonb_build_object('phone', _phone, 'address', _address, 'city', _city),
          'Pro', v_business_type, false)
  RETURNING id INTO v_tid;

  IF v_trial_plan_id IS NOT NULL THEN
    INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, started_at, expires_at)
    VALUES (v_tid, v_trial_plan_id, 'trialing', now(), now() + interval '7 days');
  END IF;

  DELETE FROM public.tenant_members WHERE user_id = v_uid;
  INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES (v_tid, v_uid, 'owner');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'admin'::public.app_role) ON CONFLICT DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = v_uid AND role = 'cashier'::public.app_role
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.role = 'admin'::public.app_role);

  UPDATE public.store_settings SET phone = COALESCE(_phone, phone), address = COALESCE(v_addr, address)
   WHERE tenant_id = v_tid;

  RETURN v_tid;
END $function$
;
