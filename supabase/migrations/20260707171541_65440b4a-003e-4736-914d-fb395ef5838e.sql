
-- =========================================================================
-- Sprint 4D Task 1 (step 2): permission matrix + role escalation guardrails.
-- =========================================================================

-- 1. Role -> permission defaults
CREATE TABLE IF NOT EXISTS public.tenant_role_permissions (
  role       public.tenant_role NOT NULL,
  permission text               NOT NULL,
  PRIMARY KEY (role, permission)
);

GRANT SELECT ON public.tenant_role_permissions TO authenticated;
GRANT ALL    ON public.tenant_role_permissions TO service_role;

ALTER TABLE public.tenant_role_permissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='tenant_role_permissions'
      AND policyname='tenant_role_permissions_read_all_auth'
  ) THEN
    CREATE POLICY tenant_role_permissions_read_all_auth
      ON public.tenant_role_permissions
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

INSERT INTO public.tenant_role_permissions(role, permission) VALUES
  ('owner','create_sale'),('owner','edit_sale'),('owner','delete_sale'),
  ('owner','view_reports'),('owner','manage_products'),('owner','manage_users'),
  ('owner','manage_settings'),('owner','view_financial_data'),
  ('owner','manage_suppliers'),('owner','manage_customers'),
  ('owner','manage_expenses'),('owner','record_payments'),
  ('owner','process_returns'),('owner','view_audit_logs'),
  ('admin','create_sale'),('admin','edit_sale'),('admin','delete_sale'),
  ('admin','view_reports'),('admin','manage_products'),('admin','manage_users'),
  ('admin','manage_settings'),('admin','view_financial_data'),
  ('admin','manage_suppliers'),('admin','manage_customers'),
  ('admin','manage_expenses'),('admin','record_payments'),
  ('admin','process_returns'),('admin','view_audit_logs'),
  ('manager','create_sale'),('manager','edit_sale'),
  ('manager','view_reports'),('manager','manage_products'),
  ('manager','view_financial_data'),
  ('manager','manage_suppliers'),('manager','manage_customers'),
  ('manager','manage_expenses'),('manager','record_payments'),
  ('manager','process_returns'),
  ('cashier','create_sale'),
  ('cashier','manage_customers'),
  ('cashier','record_payments'),
  ('cashier','process_returns'),
  ('staff','create_sale'),
  ('viewer','view_reports'),
  ('viewer','view_financial_data')
ON CONFLICT (role, permission) DO NOTHING;

-- 2. Per-user overrides
CREATE TABLE IF NOT EXISTS public.tenant_user_permissions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  granted    boolean NOT NULL DEFAULT true,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_tenant_user_permissions_lookup
  ON public.tenant_user_permissions (tenant_id, user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_user_permissions TO authenticated;
GRANT ALL ON public.tenant_user_permissions TO service_role;

ALTER TABLE public.tenant_user_permissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='tenant_user_permissions' AND policyname='tup_select') THEN
    CREATE POLICY tup_select ON public.tenant_user_permissions
      FOR SELECT TO authenticated
      USING (
        user_id = auth.uid()
        OR public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='tenant_user_permissions' AND policyname='tup_write_admin') THEN
    CREATE POLICY tup_write_admin ON public.tenant_user_permissions
      FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role))
      WITH CHECK (public.has_role(auth.uid(), tenant_id, 'admin'::public.tenant_role));
  END IF;
END $$;

-- 3. Tenant-scoped permission check
CREATE OR REPLACE FUNCTION public.has_tenant_permission(
  _user_id uuid, _tenant_id uuid, _perm text
) RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT granted FROM public.tenant_user_permissions
       WHERE user_id = _user_id AND tenant_id = _tenant_id AND permission = _perm
       LIMIT 1),
    EXISTS (
      SELECT 1
      FROM public.tenant_members m
      JOIN public.tenant_role_permissions rp ON rp.role = m.role
      WHERE m.user_id = _user_id
        AND m.tenant_id = _tenant_id
        AND rp.permission = _perm
    )
  );
$$;

REVOKE ALL ON FUNCTION public.has_tenant_permission(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_tenant_permission(uuid,uuid,text)
  TO authenticated, service_role;

-- 4. Guardrails on tenant_members
CREATE OR REPLACE FUNCTION public.enforce_tenant_member_guardrails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_owner_count int;
BEGIN
  IF v_actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id = v_actor AND NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'You cannot change your own role';
    END IF;
    IF (NEW.role = 'owner' OR OLD.role = 'owner')
       AND NOT public.has_role(v_actor, NEW.tenant_id, 'owner'::public.tenant_role) THEN
      RAISE EXCEPTION 'Only a tenant owner can assign or remove the owner role';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'owner'
       AND EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = NEW.tenant_id)
       AND NOT public.has_role(v_actor, NEW.tenant_id, 'owner'::public.tenant_role) THEN
      RAISE EXCEPTION 'Only a tenant owner can add another owner';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' THEN
      SELECT count(*) INTO v_owner_count
        FROM public.tenant_members
        WHERE tenant_id = OLD.tenant_id AND role = 'owner';
      IF v_owner_count <= 1 THEN
        RAISE EXCEPTION 'Cannot remove the last owner of a tenant';
      END IF;
      IF NOT public.has_role(v_actor, OLD.tenant_id, 'owner'::public.tenant_role) THEN
        RAISE EXCEPTION 'Only a tenant owner can remove an owner';
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_tenant_members_guardrails ON public.tenant_members;
CREATE TRIGGER trg_tenant_members_guardrails
  BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_member_guardrails();

-- 5. Guardrails on legacy user_roles: block self-mutation
CREATE OR REPLACE FUNCTION public.enforce_user_roles_guardrails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.user_id = v_actor THEN
    RAISE EXCEPTION 'You cannot modify your own role assignments';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.user_id = v_actor THEN
    RAISE EXCEPTION 'You cannot modify your own role assignments';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_user_roles_guardrails ON public.user_roles;
CREATE TRIGGER trg_user_roles_guardrails
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_roles_guardrails();
