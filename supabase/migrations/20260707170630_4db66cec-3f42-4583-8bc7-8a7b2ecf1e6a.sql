-- Sprint 4C Task 2: backup metadata (additive)

CREATE TABLE IF NOT EXISTS public.backup_metadata (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  backup_type   TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  size_bytes    BIGINT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.backup_metadata TO authenticated;
GRANT ALL    ON public.backup_metadata TO service_role;

CREATE INDEX IF NOT EXISTS backup_metadata_tenant_created_idx
  ON public.backup_metadata (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS backup_metadata_status_idx
  ON public.backup_metadata (status);

ALTER TABLE public.backup_metadata ENABLE ROW LEVEL SECURITY;

-- Tenant members read their own tenant's rows.
DROP POLICY IF EXISTS backup_metadata_select_tenant ON public.backup_metadata;
CREATE POLICY backup_metadata_select_tenant ON public.backup_metadata
  FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.current_tenant_id());

-- Restrictive isolation (defence in depth).
DROP POLICY IF EXISTS tenant_isolation_select ON public.backup_metadata;
CREATE POLICY tenant_isolation_select ON public.backup_metadata
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.current_tenant_id());

-- No INSERT/UPDATE/DELETE policies for authenticated: backup runners use service role.