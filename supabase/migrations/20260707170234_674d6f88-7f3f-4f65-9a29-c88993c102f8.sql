-- Sprint 4C Task 1: application error logging (additive)

CREATE TABLE IF NOT EXISTS public.application_errors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id        UUID,
  error_type     TEXT NOT NULL,
  error_message  TEXT NOT NULL,
  stack_trace    TEXT,
  page_or_module TEXT,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.application_errors TO authenticated;
GRANT ALL             ON public.application_errors TO service_role;

CREATE INDEX IF NOT EXISTS application_errors_tenant_created_idx
  ON public.application_errors (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS application_errors_user_idx
  ON public.application_errors (user_id);
CREATE INDEX IF NOT EXISTS application_errors_type_idx
  ON public.application_errors (error_type);

ALTER TABLE public.application_errors ENABLE ROW LEVEL SECURITY;

-- SELECT: members of a tenant can see that tenant's errors.
DROP POLICY IF EXISTS application_errors_select_tenant ON public.application_errors;
CREATE POLICY application_errors_select_tenant ON public.application_errors
  FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.current_tenant_id());

-- Restrictive isolation, consistent with Task 1 pattern.
DROP POLICY IF EXISTS tenant_isolation_select ON public.application_errors;
CREATE POLICY tenant_isolation_select ON public.application_errors
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.current_tenant_id());

-- No direct INSERT/UPDATE/DELETE policies — writes go through the SECURITY DEFINER function below.

-- Reusable logger. Callers pass details; function stamps tenant + user from session.
CREATE OR REPLACE FUNCTION public.log_application_error(
  _error_type     TEXT,
  _error_message  TEXT,
  _stack_trace    TEXT DEFAULT NULL,
  _page_or_module TEXT DEFAULT NULL,
  _metadata       JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.application_errors (
    tenant_id, user_id, error_type, error_message, stack_trace, page_or_module, metadata
  ) VALUES (
    public.current_tenant_id(),
    auth.uid(),
    COALESCE(NULLIF(_error_type, ''), 'unknown'),
    COALESCE(NULLIF(_error_message, ''), 'unspecified error'),
    _stack_trace,
    _page_or_module,
    _metadata
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.log_application_error(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_application_error(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;