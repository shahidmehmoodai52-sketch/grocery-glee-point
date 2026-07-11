
CREATE OR REPLACE FUNCTION public.admin_clear_security_events(
  _severity text DEFAULT NULL,
  _older_than_days integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: super admin only';
  END IF;

  WITH del AS (
    DELETE FROM public.security_events
    WHERE (_severity IS NULL OR severity = _severity)
      AND (_older_than_days IS NULL OR created_at < now() - make_interval(days => _older_than_days))
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM del;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_clear_security_events(text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_security_events(text, integer) TO authenticated;
