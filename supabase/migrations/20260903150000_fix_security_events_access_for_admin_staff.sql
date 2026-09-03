-- security_events' only RLS SELECT policy checks the legacy
-- has_role(auth.uid(), 'super_admin') role, not the modern
-- admin_has_perm(auth.uid(), 'shops.view') permission that admin staff can
-- be granted. admin_list_security_events already correctly gates on
-- admin_has_perm('shops.view') and is used for the dashboard's small events
-- widget, but admin.tsx's full Security tab and admin_.shops.$id.tsx's
-- TenantSecurityCard both read the security_events table DIRECTLY (relying
-- on its RLS policy) instead of going through that RPC — so an admin staff
-- member granted 'shops.view' (but not literally flagged super_admin) sees
-- the dashboard widget populate, then the Security tab and per-shop card
-- silently show zero events. Fix: extend admin_list_security_events with
-- the filters the Security tab already applies client-side (event_type,
-- date range), and add a tenant-scoped counterpart for the per-shop card.
-- Both go through admin_has_perm('shops.view'), matching every other
-- admin-staff-delegable read RPC in this codebase.

-- CREATE OR REPLACE with an additive signature creates a NEW overload
-- instead of replacing the old one, leaving both the old 2-arg and new
-- 5-arg admin_list_security_events around. That's ambiguous: the existing
-- frontend call site passes only `_limit` by name, which then matches both
-- overloads (both have every other parameter defaulted) and errors with
-- "function is not unique". Drop the old 2-arg overload first.
DROP FUNCTION IF EXISTS public.admin_list_security_events(integer, text);

CREATE OR REPLACE FUNCTION public.admin_list_security_events(
  _limit integer DEFAULT 200,
  _severity text DEFAULT NULL::text,
  _event_type text DEFAULT NULL::text,
  _from_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  _to_date timestamp with time zone DEFAULT NULL::timestamp with time zone
)
 RETURNS SETOF security_events
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT * FROM public.security_events
  WHERE (_severity IS NULL OR severity = _severity)
    AND (_event_type IS NULL OR event_type ILIKE '%' || _event_type || '%')
    AND (_from_date IS NULL OR created_at >= _from_date)
    AND (_to_date IS NULL OR created_at <= _to_date)
  ORDER BY created_at DESC
  LIMIT COALESCE(_limit, 200);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_security_events(integer, text, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_security_events(integer, text, text, timestamp with time zone, timestamp with time zone) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_tenant_security_events(_tenant_id uuid, _limit integer DEFAULT 100)
 RETURNS SETOF security_events
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT * FROM public.security_events
  WHERE tenant_id = _tenant_id
  ORDER BY created_at DESC
  LIMIT COALESCE(_limit, 100);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_tenant_security_events(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_tenant_security_events(uuid, integer) TO authenticated;
