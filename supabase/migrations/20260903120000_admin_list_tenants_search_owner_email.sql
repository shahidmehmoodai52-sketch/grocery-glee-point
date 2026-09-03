-- admin_list_tenants's search box has always been labelled "Search shops by
-- name, owner, email…", and matched owner name/email client-side before the
-- 2026-09-01 pagination migration moved search server-side. That migration's
-- WHERE clause only reproduced the name/slug match, silently dropping
-- owner-name and owner-email search even though both are already joined
-- into the result set (p.full_name, u.email). Restore it additively.
CREATE OR REPLACE FUNCTION public.admin_list_tenants(_search text DEFAULT NULL::text, _status text DEFAULT NULL::text, _limit integer DEFAULT NULL::integer, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, name text, slug text, status text, plan text, owner_id uuid, owner_name text, owner_email text, member_count integer, product_count integer, sales_count integer, sales_total numeric, subscription_status text, subscription_expires_at timestamp with time zone, created_at timestamp with time zone, last_activity_at timestamp with time zone, total_count bigint, last_login_at timestamp with time zone, plan_max_users integer, plan_max_products integer)
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
  WHERE (
      _search IS NULL OR _search = ''
      OR t.name ILIKE '%' || _search || '%'
      OR t.slug ILIKE '%' || _search || '%'
      OR p.full_name ILIKE '%' || _search || '%'
      OR u.email ILIKE '%' || _search || '%'
    )
    AND (_status IS NULL OR t.status = _status)
  ORDER BY t.created_at DESC
  LIMIT _limit
  OFFSET _offset;
END $function$;
