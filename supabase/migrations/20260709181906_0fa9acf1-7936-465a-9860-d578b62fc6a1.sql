CREATE OR REPLACE FUNCTION public.admin_tenant_detail(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
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
END $$;