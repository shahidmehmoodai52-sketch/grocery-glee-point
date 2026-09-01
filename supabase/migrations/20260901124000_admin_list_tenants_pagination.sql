-- admin_list_tenants() has no pagination/search/filter parameters and is
-- always called unbounded; the Tenants tab then does client-side search and
-- status filtering over the full in-memory result set. Extend it
-- additively with server-side search/status filtering and optional
-- limit/offset (returning total_count via a window function for the
-- paginated case). When _limit is omitted (NULL), behavior is byte-for-byte
-- identical to today: no WHERE-narrowing beyond an always-true predicate
-- fold, no LIMIT applied (Postgres treats LIMIT NULL as unlimited), OFFSET
-- 0. This means DashboardTab and ErrorsTab, which need the full tenant list
-- for their aggregate cards, need no code changes -- only TenantsTab, which
-- will start passing real search/status/limit/offset, changes.
--
-- The old zero-arg signature is dropped first to avoid an ambiguous-overload
-- error on the existing no-argument call sites (all four new parameters
-- have defaults, so a bare admin_list_tenants() call still resolves fine
-- once only one signature exists).

DROP FUNCTION IF EXISTS public.admin_list_tenants();

CREATE OR REPLACE FUNCTION public.admin_list_tenants(
  _search text DEFAULT NULL,
  _status text DEFAULT NULL,
  _limit integer DEFAULT NULL,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  name text,
  slug text,
  status text,
  plan text,
  owner_id uuid,
  owner_name text,
  owner_email text,
  member_count integer,
  product_count integer,
  sales_count integer,
  sales_total numeric,
  subscription_status text,
  subscription_expires_at timestamp with time zone,
  created_at timestamp with time zone,
  total_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  SELECT t.id, t.name, t.slug, t.status, t.plan, t.owner_id,
    p.full_name, u.email::text,
    (SELECT COUNT(*)::int FROM public.tenant_members m WHERE m.tenant_id = t.id),
    (SELECT COUNT(*)::int FROM public.products pr WHERE pr.tenant_id = t.id),
    (SELECT COUNT(*)::int FROM public.sales s WHERE s.tenant_id = t.id),
    COALESCE((SELECT SUM(s.total) FROM public.sales s WHERE s.tenant_id = t.id), 0),
    (SELECT ts.status FROM public.tenant_subscriptions ts WHERE ts.tenant_id = t.id ORDER BY ts.started_at DESC LIMIT 1),
    (SELECT ts.expires_at FROM public.tenant_subscriptions ts WHERE ts.tenant_id = t.id ORDER BY ts.started_at DESC LIMIT 1),
    t.created_at,
    COUNT(*) OVER()
  FROM public.tenants t
  LEFT JOIN public.profiles p ON p.id = t.owner_id
  LEFT JOIN auth.users u ON u.id = t.owner_id
  WHERE (_search IS NULL OR _search = '' OR t.name ILIKE '%' || _search || '%' OR t.slug ILIKE '%' || _search || '%')
    AND (_status IS NULL OR t.status = _status)
  ORDER BY t.created_at DESC
  LIMIT _limit
  OFFSET _offset;
END $function$;

REVOKE ALL ON FUNCTION public.admin_list_tenants(text, text, integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_tenants(text, text, integer, integer) TO authenticated;
