ALTER TABLE public.application_errors
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_note text;

CREATE INDEX IF NOT EXISTS idx_application_errors_unresolved
  ON public.application_errors(created_at DESC)
  WHERE resolved_at IS NULL;

CREATE OR REPLACE FUNCTION public.admin_resolve_error(_id uuid, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.application_errors
     SET resolved_at = now(),
         resolved_by = auth.uid(),
         resolution_note = COALESCE(_note, resolution_note)
   WHERE id = _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_errors_bulk(
  _tenant_id uuid DEFAULT NULL,
  _error_type text DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.application_errors
     SET resolved_at = now(),
         resolved_by = auth.uid(),
         resolution_note = COALESCE(_note, resolution_note)
   WHERE resolved_at IS NULL
     AND (_tenant_id IS NULL OR tenant_id = _tenant_id)
     AND (_error_type IS NULL OR error_type = _error_type);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_recent_errors(integer);

CREATE OR REPLACE FUNCTION public.admin_recent_errors(_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  user_id uuid,
  error_type text,
  error_message text,
  page_or_module text,
  stack_trace text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
    SELECT e.id, e.tenant_id, e.user_id, e.error_type, e.error_message,
           e.page_or_module, e.stack_trace, e.created_at
      FROM public.application_errors e
     WHERE e.resolved_at IS NULL
     ORDER BY e.created_at DESC
     LIMIT COALESCE(_limit, 100);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_resolve_error(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_errors_bulk(uuid, text, text) TO authenticated;