
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.am_i_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_super_admin(auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.my_tenant_status()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT status FROM public.tenants WHERE id = public.current_tenant_id() LIMIT 1
$$;

CREATE POLICY "super_admin read all tenants" ON public.tenants
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));
CREATE POLICY "super_admin update all tenants" ON public.tenants
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "super_admin read all members" ON public.tenant_members
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE POLICY "super_admin read all subs" ON public.tenant_subscriptions
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));
CREATE POLICY "super_admin write subs" ON public.tenant_subscriptions
  FOR ALL TO authenticated USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "super_admin read all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE POLICY "super_admin read errors" ON public.application_errors
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE POLICY "super_admin read all user_roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_list_tenants()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  status text,
  plan text,
  owner_id uuid,
  owner_name text,
  owner_email text,
  member_count int,
  product_count int,
  sales_count int,
  sales_total numeric,
  subscription_status text,
  subscription_expires_at timestamptz,
  created_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT
    t.id, t.name, t.slug, t.status, t.plan, t.owner_id,
    p.full_name,
    u.email::text,
    (SELECT COUNT(*)::int FROM public.tenant_members m WHERE m.tenant_id = t.id),
    (SELECT COUNT(*)::int FROM public.products pr WHERE pr.tenant_id = t.id),
    (SELECT COUNT(*)::int FROM public.sales s WHERE s.tenant_id = t.id),
    COALESCE((SELECT SUM(s.total) FROM public.sales s WHERE s.tenant_id = t.id), 0),
    (SELECT ts.status FROM public.tenant_subscriptions ts
       WHERE ts.tenant_id = t.id ORDER BY ts.started_at DESC LIMIT 1),
    (SELECT ts.expires_at FROM public.tenant_subscriptions ts
       WHERE ts.tenant_id = t.id ORDER BY ts.started_at DESC LIMIT 1),
    t.created_at
  FROM public.tenants t
  LEFT JOIN public.profiles p ON p.id = t.owner_id
  LEFT JOIN auth.users u ON u.id = t.owner_id
  ORDER BY t.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_tenant_status(_tenant_id uuid, _status text, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_super_admin(v_uid) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _status NOT IN ('active','suspended','pending','archived') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;
  UPDATE public.tenants SET status = _status, updated_at = now() WHERE id = _tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenant not found'; END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, new_data)
  VALUES (_tenant_id, v_uid, 'ADMIN_SET_STATUS', 'tenants', _tenant_id,
          jsonb_build_object('status', _status, 'reason', _reason));
  RETURN _tenant_id;
END $$;

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
        'joined_at', m.joined_at,
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

CREATE OR REPLACE FUNCTION public.admin_recent_errors(_limit int DEFAULT 50)
RETURNS SETOF public.application_errors LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.application_errors ORDER BY created_at DESC LIMIT COALESCE(_limit,50);
END $$;

DO $$
DECLARE v_uid uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role::text = 'super_admin') THEN
    SELECT user_id INTO v_uid FROM public.user_roles WHERE role::text = 'admin'
      ORDER BY user_id LIMIT 1;
    IF v_uid IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'super_admin'::public.app_role)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END $$;
