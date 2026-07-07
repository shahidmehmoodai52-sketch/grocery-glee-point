
-- ============================================================
-- Sprint 4A — Fix W1 (new-user provisioning) and W2 (store_settings singleton)
-- Additive, non-destructive. No RLS/NOT NULL/index/uniqueness changes to
-- Phase 4B targets. UI, RPCs, and existing policies are untouched.
-- ============================================================

-- ------------------------------------------------------------
-- W2: replace store_settings singleton with per-tenant row
-- ------------------------------------------------------------

-- 1. Remove the id = 1 CHECK that hard-codes the singleton.
ALTER TABLE public.store_settings
  DROP CONSTRAINT IF EXISTS store_settings_id_check;

-- 2. Guarantee one settings row per tenant (structural fix for W2).
--    Safe: only one row exists today (Default Shop), so the constraint
--    validates immediately.
ALTER TABLE public.store_settings
  DROP CONSTRAINT IF EXISTS store_settings_tenant_id_unique;
ALTER TABLE public.store_settings
  ADD CONSTRAINT store_settings_tenant_id_unique UNIQUE (tenant_id);

-- 3. Give `id` a real sequence-backed default so future tenants can get
--    their own numeric id. Existing Default Shop keeps id = 1.
CREATE SEQUENCE IF NOT EXISTS public.store_settings_id_seq AS integer;
SELECT setval(
  'public.store_settings_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.store_settings), 1),
  true
);
ALTER TABLE public.store_settings
  ALTER COLUMN id SET DEFAULT nextval('public.store_settings_id_seq');
ALTER SEQUENCE public.store_settings_id_seq OWNED BY public.store_settings.id;
GRANT USAGE ON SEQUENCE public.store_settings_id_seq TO authenticated, service_role;

-- 4. Compatibility helper for future multi-tenant screens.
--    Current UI still does .eq("id", 1) and continues to work unchanged.
CREATE OR REPLACE FUNCTION public.my_store_settings()
RETURNS SETOF public.store_settings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.store_settings
  WHERE tenant_id = public.current_tenant_id()
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.my_store_settings() TO authenticated;

-- 5. When a new tenant is created, provision its store_settings row.
CREATE OR REPLACE FUNCTION public.provision_tenant_store_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.store_settings (tenant_id, store_name)
  VALUES (NEW.id, COALESCE(NEW.name, 'My Grocery Store'))
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_provision_tenant_store_settings ON public.tenants;
CREATE TRIGGER trg_provision_tenant_store_settings
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.provision_tenant_store_settings();


-- ------------------------------------------------------------
-- W1: auto-provision tenant + membership for genuinely new signups,
--     while leaving invitation-flow signups alone.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_count      int;
  v_tenant_id       uuid;
  v_email           text := lower(COALESCE(NEW.email, ''));
  v_full_name       text := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);
  v_tenant_name     text := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'tenant_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'business_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)) || '''s Shop'
  );
  v_has_invitation  boolean := false;
BEGIN
  -- 1) Profile (existing behaviour preserved)
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, v_full_name)
  ON CONFLICT (id) DO NOTHING;

  -- 2) user_roles (existing behaviour preserved: first user = admin, rest = cashier)
  SELECT COUNT(*) INTO v_user_count FROM auth.users;
  IF v_user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'cashier')
    ON CONFLICT DO NOTHING;
  END IF;

  -- 3) Tenant provisioning (new)
  --    a. Skip when this signup is answering a pending invitation.
  IF v_email <> '' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.tenant_invitations
      WHERE lower(email) = v_email
        AND accepted_at IS NULL
        AND expires_at > now()
    ) INTO v_has_invitation;
  END IF;

  IF v_has_invitation THEN
    -- Invitation acceptance flow will attach the user to the correct tenant.
    RETURN NEW;
  END IF;

  --    b. Idempotency: never create a second tenant for a user who is
  --       already a member of one (protects re-runs and existing users).
  IF EXISTS (SELECT 1 FROM public.tenant_members WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  --    c. Fresh business: create a tenant, own it, store_settings is
  --       provisioned by trg_provision_tenant_store_settings.
  INSERT INTO public.tenants (name, owner_id)
  VALUES (v_tenant_name, NEW.id)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_members (tenant_id, user_id, role)
  VALUES (v_tenant_id, NEW.id, 'owner')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;
