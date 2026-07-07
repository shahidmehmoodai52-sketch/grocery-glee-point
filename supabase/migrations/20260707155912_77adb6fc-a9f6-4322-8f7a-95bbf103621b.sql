
-- =========================
-- Phase 1: Multi-tenant foundation (additive)
-- =========================

-- Tenant-scoped role enum (kept separate from existing app_role for backward compat)
DO $$ BEGIN
  CREATE TYPE public.tenant_role AS ENUM ('owner','admin','manager','cashier','viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- tenants ----
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- ---- tenant_members ----
CREATE TABLE public.tenant_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.tenant_role NOT NULL DEFAULT 'cashier',
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX tenant_members_user_idx ON public.tenant_members(user_id);
CREATE INDEX tenant_members_tenant_idx ON public.tenant_members(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_members TO authenticated;
GRANT ALL ON public.tenant_members TO service_role;
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

-- ---- tenant_invitations ----
CREATE TABLE public.tenant_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.tenant_role NOT NULL DEFAULT 'cashier',
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX tenant_invitations_tenant_idx ON public.tenant_invitations(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_invitations TO authenticated;
GRANT ALL ON public.tenant_invitations TO service_role;
ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;

-- =========================
-- Helper functions
-- =========================

-- is_tenant_member: is the given user a member of the given tenant?
CREATE OR REPLACE FUNCTION public.is_tenant_member(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = _user_id AND tenant_id = _tenant_id
  );
$$;

-- current_tenant_id: resolves active tenant for the current request.
-- Order of resolution:
--   1) JWT app_metadata.tenant_id claim (set by Auth hook in a later phase)
--   2) Session GUC 'app.current_tenant_id' (opt-in for server code)
--   3) The user's sole tenant membership, if exactly one exists
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_claim text;
  v_guc text;
  v_uid uuid := auth.uid();
  v_tid uuid;
  v_count int;
BEGIN
  -- 1) JWT claim
  BEGIN
    v_claim := (current_setting('request.jwt.claims', true)::jsonb
                 -> 'app_metadata' ->> 'tenant_id');
    IF v_claim IS NOT NULL AND v_claim <> '' THEN
      RETURN v_claim::uuid;
    END IF;
  EXCEPTION WHEN others THEN NULL; END;

  -- 2) Session GUC
  BEGIN
    v_guc := current_setting('app.current_tenant_id', true);
    IF v_guc IS NOT NULL AND v_guc <> '' THEN
      RETURN v_guc::uuid;
    END IF;
  EXCEPTION WHEN others THEN NULL; END;

  -- 3) Sole membership fallback
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT count(*), min(tenant_id) INTO v_count, v_tid
    FROM public.tenant_members WHERE user_id = v_uid;
  IF v_count = 1 THEN RETURN v_tid; END IF;

  RETURN NULL;
END $$;

-- Tenant-scoped has_role overload (does NOT touch existing has_role(_user,_role))
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _tenant_id uuid, _role public.tenant_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = _user_id
      AND tenant_id = _tenant_id
      AND (
        role = _role
        OR (_role = 'admin'   AND role IN ('owner'))
        OR (_role = 'manager' AND role IN ('owner','admin'))
        OR (_role = 'cashier' AND role IN ('owner','admin','manager'))
        OR (_role = 'viewer'  AND role IN ('owner','admin','manager','cashier'))
      )
  );
$$;

-- Tenant-scoped has_permission overload.
-- For Phase 1 we only key off tenant role (owner/admin => all perms).
-- A tenant-scoped user_permissions table will be introduced in a later phase.
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _tenant_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = _user_id
      AND tenant_id = _tenant_id
      AND role IN ('owner','admin')
  );
$$;

-- updated_at trigger reuse (create if not present)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_tenants_touch BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_tenant_members_touch BEFORE UPDATE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_tenant_invitations_touch BEFORE UPDATE ON public.tenant_invitations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================
-- RLS policies
-- =========================

-- tenants: members can view; only owner can modify
CREATE POLICY "tenants_select_members" ON public.tenants
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), id));

CREATE POLICY "tenants_insert_owner" ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "tenants_update_owner" ON public.tenants
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "tenants_delete_owner" ON public.tenants
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- tenant_members: user sees their own memberships and tenant admins/owners see all in their tenant.
-- No self-referencing subquery on tenant_members (avoids RLS recursion) — use SECURITY DEFINER helper.
CREATE POLICY "tenant_members_select_self_or_admin" ON public.tenant_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role)
  );

CREATE POLICY "tenant_members_insert_admin" ON public.tenant_members
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role));

CREATE POLICY "tenant_members_update_admin" ON public.tenant_members
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role))
  WITH CHECK (public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role));

CREATE POLICY "tenant_members_delete_admin" ON public.tenant_members
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role));

-- tenant_invitations: only tenant admins/owners
CREATE POLICY "tenant_invitations_admin_all" ON public.tenant_invitations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role))
  WITH CHECK (public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role));

-- =========================
-- Seed: Default Shop + backfill memberships
-- =========================
DO $$
DECLARE
  v_tenant_id uuid;
  v_owner uuid;
BEGIN
  SELECT ur.user_id INTO v_owner
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.user_id
    LIMIT 1;

  INSERT INTO public.tenants (name, slug, owner_id)
  VALUES ('Default Shop', 'default-shop', v_owner)
  RETURNING id INTO v_tenant_id;

  -- Enroll every existing auth user, mapping app_role -> tenant_role.
  -- Owner user gets 'owner'; existing admins get 'admin'; everyone else 'cashier'.
  INSERT INTO public.tenant_members (tenant_id, user_id, role)
  SELECT
    v_tenant_id,
    u.id,
    CASE
      WHEN u.id = v_owner THEN 'owner'::public.tenant_role
      WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'admin')
        THEN 'admin'::public.tenant_role
      ELSE 'cashier'::public.tenant_role
    END
  FROM auth.users u
  ON CONFLICT (tenant_id, user_id) DO NOTHING;
END $$;
