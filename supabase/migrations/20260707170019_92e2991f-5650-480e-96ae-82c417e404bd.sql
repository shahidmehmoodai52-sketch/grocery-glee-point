-- Sprint 4B Task 3: audit logging foundation (additive)

-- 1) Table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     UUID,
  action      TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  table_name  TEXT NOT NULL,
  record_id   UUID,
  old_data    JSONB,
  new_data    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) Grants (must precede RLS per project convention)
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL    ON public.audit_logs TO service_role;

-- 3) Indexes
CREATE INDEX IF NOT EXISTS audit_logs_tenant_created_idx ON public.audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_table_idx   ON public.audit_logs (tenant_id, table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_record_idx         ON public.audit_logs (record_id);
CREATE INDEX IF NOT EXISTS audit_logs_user_idx           ON public.audit_logs (user_id);

-- 4) RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Tenant members can read their own tenant's logs.
DROP POLICY IF EXISTS audit_logs_select_tenant ON public.audit_logs;
CREATE POLICY audit_logs_select_tenant ON public.audit_logs
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- Restrictive tenant isolation (defence in depth, consistent with Task 1).
DROP POLICY IF EXISTS tenant_isolation_select ON public.audit_logs;
CREATE POLICY tenant_isolation_select ON public.audit_logs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- No INSERT/UPDATE/DELETE policies: triggers run as SECURITY DEFINER and
-- bypass RLS; the app is not permitted to write directly.

-- 5) Trigger function
CREATE OR REPLACE FUNCTION public.log_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   UUID;
  v_record   UUID;
  v_old      JSONB;
  v_new      JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
    v_tenant := (v_old->>'tenant_id')::UUID;
    BEGIN v_record := (v_old->>'id')::UUID; EXCEPTION WHEN others THEN v_record := NULL; END;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_tenant := COALESCE((v_new->>'tenant_id')::UUID, (v_old->>'tenant_id')::UUID);
    BEGIN v_record := (v_new->>'id')::UUID; EXCEPTION WHEN others THEN v_record := NULL; END;
  ELSE -- INSERT
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_tenant := (v_new->>'tenant_id')::UUID;
    BEGIN v_record := (v_new->>'id')::UUID; EXCEPTION WHEN others THEN v_record := NULL; END;
  END IF;

  -- If a row somehow lacks tenant_id (e.g. legacy path), fall back to session tenant.
  IF v_tenant IS NULL THEN
    v_tenant := public.current_tenant_id();
  END IF;

  -- Only record when we know the tenant; never insert a NULL tenant row.
  IF v_tenant IS NOT NULL THEN
    INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, old_data, new_data)
    VALUES (v_tenant, auth.uid(), TG_OP, TG_TABLE_NAME, v_record, v_old, v_new);
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

-- 6) Attach AFTER triggers to critical tables (idempotent).
DO $$
DECLARE
  t text;
  critical_tables text[] := ARRAY[
    'products','customers','suppliers','sales','purchases','party_payments','expenses'
  ];
BEGIN
  FOREACH t IN ARRAY critical_tables LOOP
    EXECUTE format($f$
      DROP TRIGGER IF EXISTS trg_audit_%1$s ON public.%1$I;
      CREATE TRIGGER trg_audit_%1$s
        AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
        FOR EACH ROW EXECUTE FUNCTION public.log_audit();
    $f$, t);
  END LOOP;
END $$;