-- Phase H: RBAC access consistency. Concrete, narrow fixes only -- no
-- redesign of the RBAC system, no new permission keys, no loosening of
-- any destructive permission.

-- admin_list_security_events is read-only (SETOF security_events, no
-- writes) and returns the same category of data admin_security_summary
-- already aggregates -- and that RPC already uses admin_has_perm(...,
-- 'shops.view') (fixed in an earlier pass). This one was left on the
-- legacy has_role(...,'super_admin') check, so a staff member granted
-- 'shops.view' (who can already see the full Security tab's event list
-- directly, via that table's own RLS policy) is unnecessarily blocked
-- from the small "recent security events" widget on the Dashboard tab
-- that calls this specific RPC. Fail-safe (over-restrictive), not a
-- vulnerability, but a genuine inconsistency -- bring it in line with its
-- sibling RPC.
CREATE OR REPLACE FUNCTION public.admin_list_security_events(_limit integer DEFAULT 200, _severity text DEFAULT NULL::text)
RETURNS SETOF public.security_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT * FROM public.security_events
  WHERE (_severity IS NULL OR severity = _severity)
  ORDER BY created_at DESC
  LIMIT COALESCE(_limit, 200);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_security_events(integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_security_events(integer, text) TO authenticated;
