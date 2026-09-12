-- Phase 2 of multi-business-type support: adds a `business_type` column to
-- tenants (default 'grocery', so every existing tenant keeps behaving
-- exactly as today) and lets register_shop() set it at signup time. This is
-- purely additive — no existing column, RLS policy, or RPC behavior for
-- current (grocery) tenants changes.
--
-- Verified on the tillix-migration-test Supabase project before being added
-- here: existing tenant rows all backfilled to business_type='grocery',
-- register_shop() still creates/updates shops correctly with the new
-- optional param defaulting to 'grocery', and get_advisors reported no new
-- security issues.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'grocery';

DO $$ BEGIN
  ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_business_type_check
    CHECK (business_type IN ('grocery', 'pharmacy'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- New business types (garments, hardware, etc.) get added here via a
-- one-line ALTER ... DROP CONSTRAINT / ADD CONSTRAINT in a future migration.

CREATE INDEX IF NOT EXISTS idx_tenants_business_type ON public.tenants(business_type);

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
  IF v_business_type NOT IN ('grocery', 'pharmacy') THEN
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
