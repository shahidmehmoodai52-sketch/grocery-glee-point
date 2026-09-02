-- Phase G: Expand tenant health/usage. Does not touch the existing
-- indicators (subscription_status/expires_at, last_activity_at,
-- member_count, product_count, sales_count/total all already returned by
-- admin_list_tenants and already rendered in TenantsTab) -- this only adds
-- genuinely missing columns, computed from real, existing data:
--
-- - last_login_at: auth.users.last_sign_in_at for the tenant's owner --
--   already-real Supabase auth data, not a new tracking mechanism.
-- - plan_max_users / plan_max_products: the tenant's ACTUAL plan limits
--   from subscription_plans (via its active tenant_subscriptions row, or
--   by matching the legacy tenants.plan name when no subscription row
--   exists yet) -- not invented numbers. Combined with the already-
--   returned member_count/product_count, the frontend can show "8/10
--   seats" style usage and near-limit warnings without any new query.
--
-- Sync backlog/pending/failed is deliberately NOT added: the offline sync
-- queue is client-side per device (IndexedDB), so there is no reliable
-- server-side sync-freshness signal to report honestly (same reasoning
-- already documented for the Health tab's omitted "Data/Sync" check).
-- "Last sale" is also not added as a separate column: last_activity_at
-- already is MAX(sales.created_at) when sales exist, so a second column
-- would just duplicate it.
--
-- Adding output columns requires DROP + CREATE (not CREATE OR REPLACE)
-- since RETURNS TABLE's column list is changing. All existing columns are
-- unchanged and in the same order; new columns are appended at the end,
-- so this is additive for every current caller (admin_list_tenants is
-- called with named RPC args and consumed as JSON objects, not
-- positionally).

DROP FUNCTION IF EXISTS public.admin_list_tenants(text, text, integer, integer);

CREATE FUNCTION public.admin_list_tenants(_search text DEFAULT NULL, _status text DEFAULT NULL, _limit integer DEFAULT NULL, _offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid, name text, slug text, status text, plan text, owner_id uuid, owner_name text, owner_email text,
  member_count integer, product_count integer, sales_count integer, sales_total numeric,
  subscription_status text, subscription_expires_at timestamptz, created_at timestamptz,
  last_activity_at timestamptz, total_count bigint,
  last_login_at timestamptz, plan_max_users integer, plan_max_products integer
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
    COUNT(*) OVER(),
    u.last_sign_in_at,
    COALESCE(
      (SELECT sp.max_users FROM public.tenant_subscriptions ts JOIN public.subscription_plans sp ON sp.id = ts.plan_id
        WHERE ts.tenant_id = t.id AND ts.status = 'active' ORDER BY ts.started_at DESC LIMIT 1),
      (SELECT sp.max_users FROM public.subscription_plans sp WHERE sp.name = t.plan LIMIT 1)
    ),
    COALESCE(
      (SELECT sp.max_products FROM public.tenant_subscriptions ts JOIN public.subscription_plans sp ON sp.id = ts.plan_id
        WHERE ts.tenant_id = t.id AND ts.status = 'active' ORDER BY ts.started_at DESC LIMIT 1),
      (SELECT sp.max_products FROM public.subscription_plans sp WHERE sp.name = t.plan LIMIT 1)
    )
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
