-- admin_clear_security_events is a hard, permanent DELETE with no audit
-- trail of the purge itself and no floor on how recent the purged events
-- can be -- the panel's "Clear all" and "Clear info" buttons pass no age
-- filter at all, so they can wipe events from seconds ago. Add:
--
-- 1. A reason parameter, logged via log_admin_action (the RPC only runs
--    once per call, not resumably, so no idempotency guard is needed here
--    unlike admin_delete_tenant).
-- 2. A 7-day retention floor: purges always exclude events newer than 7
--    days, regardless of what _older_than_days the caller passes (or
--    omits). This is the minimal way to satisfy "prefer retention over
--    permanent delete" without introducing a new archive table -- recent
--    security signal can never be purged, structurally, not just via a
--    confirmation dialog.

DROP FUNCTION IF EXISTS public.admin_clear_security_events(text, integer);

CREATE OR REPLACE FUNCTION public.admin_clear_security_events(_severity text DEFAULT NULL, _older_than_days integer DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _n integer;
  _min_days CONSTANT integer := 7;
  _effective_days integer := GREATEST(COALESCE(_older_than_days, _min_days), _min_days);
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: super admin only';
  END IF;

  WITH del AS (
    DELETE FROM public.security_events
    WHERE (_severity IS NULL OR severity = _severity)
      AND created_at < now() - make_interval(days => _effective_days)
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM del;

  PERFORM public.log_admin_action(
    'SECURITY_EVENTS_CLEARED',
    NULL,
    'security_events',
    NULL,
    _reason,
    NULL,
    NULL,
    jsonb_build_object('severity', _severity, 'older_than_days', _effective_days, 'rows_deleted', _n)
  );

  RETURN _n;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_clear_security_events(text, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_security_events(text, integer, text) TO authenticated;
