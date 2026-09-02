-- Phase F: Advanced error observability. Additive to the existing Errors
-- tab (admin_recent_errors, admin_resolve_error(s)) -- nothing here
-- replaces or duplicates it. "Affected shops" already exists client-side
-- (grouped from admin_recent_errors) and is not rebuilt here.
--
-- Grouping/fingerprinting uses the real, always-populated
-- (error_type, page_or_module) pair as the group key -- a plain composite
-- key, not a fuzzy/ML fingerprint, described honestly as such. No new
-- column is added for this since these two existing columns already group
-- repeats correctly.

CREATE OR REPLACE FUNCTION public.admin_error_observability()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT jsonb_build_object(
    'trend', jsonb_build_object(
      'today', (SELECT COUNT(*) FROM public.application_errors WHERE created_at >= date_trunc('day', now())),
      'last_7d', (SELECT COUNT(*) FROM public.application_errors WHERE created_at >= now() - interval '7 days'),
      'previous_7d', (SELECT COUNT(*) FROM public.application_errors
        WHERE created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days')
    ),
    'top_recurring', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'error_type', s.error_type,
        'page_or_module', s.page_or_module,
        'count', s.cnt,
        'unresolved_count', s.unresolved_cnt,
        'affected_shops', s.affected_shops,
        'first_seen', s.first_seen,
        'last_seen', s.last_seen,
        'sample_message', s.sample_message
      ) ORDER BY s.cnt DESC)
      FROM (
        SELECT error_type, page_or_module,
          COUNT(*) AS cnt,
          COUNT(*) FILTER (WHERE resolved_at IS NULL) AS unresolved_cnt,
          COUNT(DISTINCT tenant_id) AS affected_shops,
          MIN(created_at) AS first_seen,
          MAX(created_at) AS last_seen,
          (array_agg(error_message ORDER BY created_at DESC))[1] AS sample_message
        FROM public.application_errors
        WHERE created_at >= now() - interval '30 days'
        GROUP BY error_type, page_or_module
        ORDER BY cnt DESC
        LIMIT 10
      ) s
    ), '[]'::jsonb),
    'recently_resolved', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'tenant_id', e.tenant_id, 'error_type', e.error_type,
        'error_message', e.error_message, 'page_or_module', e.page_or_module,
        'resolved_at', e.resolved_at, 'resolved_by', e.resolved_by, 'resolution_note', e.resolution_note
      ) ORDER BY e.resolved_at DESC)
      FROM (
        SELECT * FROM public.application_errors
        WHERE resolved_at IS NOT NULL
        ORDER BY resolved_at DESC LIMIT 20
      ) e
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_error_observability() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_error_observability() TO authenticated;

-- Reopen a mistakenly-resolved error. Same permission as resolving one
-- (admin_resolve_error already requires 'errors.manage'), same
-- log_admin_action audit convention.
CREATE OR REPLACE FUNCTION public.admin_unresolve_error(_id uuid, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant_id uuid;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'errors.manage') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT tenant_id INTO _tenant_id FROM public.application_errors WHERE id = _id;
  IF _tenant_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.application_errors WHERE id = _id) THEN
    RAISE EXCEPTION 'Error not found';
  END IF;

  UPDATE public.application_errors
     SET resolved_at = NULL, resolved_by = NULL,
         resolution_note = COALESCE(_note, resolution_note)
   WHERE id = _id;

  PERFORM public.log_admin_action(
    'ERROR_UNRESOLVE', _tenant_id, 'application_errors', _id::text, _note
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_unresolve_error(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_unresolve_error(uuid, text) TO authenticated;
