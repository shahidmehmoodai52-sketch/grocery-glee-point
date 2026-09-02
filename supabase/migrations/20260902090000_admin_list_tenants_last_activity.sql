-- Add a last_activity_at column to admin_list_tenants so the Tenants tab can
-- show a real, reliable "last activity" signal and flag tenants that look
-- inactive/problematic, per the admin-panel health-indicator improvement.
-- Reuses the same tenants/sales join the function already does; no new
-- table, no new RPC, purely an additive return column. Same auth/filter/
-- pagination behavior as before -- changing a TABLE-returning function's
-- column list requires a DROP + CREATE (Postgres does not allow CREATE OR
-- REPLACE to change the return shape), so this drops the current 4-arg
-- signature and recreates it identically plus the one new column.

DROP FUNCTION IF EXISTS public.admin_list_tenants(text, text, integer, integer);

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
  last_activity_at timestamp with time zone,
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
    GREATEST(
      (SELECT MAX(s.created_at) FROM public.sales s WHERE s.tenant_id = t.id),
      t.created_at
    ),
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
