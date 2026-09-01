-- admin_tenant_detail and admin_tenant_audit are read-only tenant-detail
-- RPCs still hard-gated to is_super_admin, while admin_list_tenants,
-- admin_shop_analytics, admin_set_tenant_status, admin_delete_tenant and
-- others already migrated to the granular admin_has_perm('shops.view'/etc.)
-- model. This is fail-safe (over-restrictive, not a vulnerability) but
-- inconsistent with the UI's delegated-staff model, which implies staff
-- granted 'shops.view' can see tenant detail/audit data. Bring these two
-- in line with the perm they logically belong to -- both are read-only and
-- already covered by the same 'shops.view' permission admin_list_tenants
-- uses. No new permission key is introduced.
--
-- Also close a separate, pre-existing gap surfaced by get_advisors while
-- touching these two functions: neither had ever had EXECUTE revoked from
-- anon, unlike the other admin_* RPCs (admin_delete_tenant, admin_list_tenants
-- etc.) which explicitly REVOKE ALL ... FROM public, anon on creation. Not a
-- data leak on its own (the functions' own Forbidden checks still block an
-- unauthenticated auth.uid() = NULL caller), but unnecessary attack surface
-- for no reason -- align with the established convention.

CREATE OR REPLACE FUNCTION public.admin_tenant_detail(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT jsonb_build_object(
    'tenant', to_jsonb(t.*),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'role', m.role,
        'joined_at', m.created_at,
        'full_name', p.full_name,
        'email', u.email
      ))
      FROM public.tenant_members m
      LEFT JOIN public.profiles p ON p.id = m.user_id
      LEFT JOIN auth.users u ON u.id = m.user_id
      WHERE m.tenant_id = _tenant_id
    ), '[]'::jsonb),
    'subscription', (
      SELECT to_jsonb(ts.*) FROM public.tenant_subscriptions ts
      WHERE ts.tenant_id = _tenant_id ORDER BY ts.started_at DESC LIMIT 1
    ),
    'stats', jsonb_build_object(
      'products', (SELECT COUNT(*) FROM public.products WHERE tenant_id=_tenant_id),
      'customers', (SELECT COUNT(*) FROM public.customers WHERE tenant_id=_tenant_id),
      'suppliers', (SELECT COUNT(*) FROM public.suppliers WHERE tenant_id=_tenant_id),
      'sales_count', (SELECT COUNT(*) FROM public.sales WHERE tenant_id=_tenant_id),
      'sales_total', COALESCE((SELECT SUM(total) FROM public.sales WHERE tenant_id=_tenant_id),0),
      'last_sale_at', (SELECT MAX(created_at) FROM public.sales WHERE tenant_id=_tenant_id)
    )
  ) INTO v_out
  FROM public.tenants t WHERE t.id = _tenant_id;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_tenant_audit(_tenant_id uuid, _limit integer DEFAULT 100)
RETURNS SETOF public.audit_logs
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.audit_logs
    WHERE tenant_id = _tenant_id
    ORDER BY created_at DESC
    LIMIT COALESCE(_limit, 100);
END $function$;

REVOKE ALL ON FUNCTION public.admin_tenant_detail(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_tenant_detail(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_tenant_audit(uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_tenant_audit(uuid, integer) TO authenticated;
