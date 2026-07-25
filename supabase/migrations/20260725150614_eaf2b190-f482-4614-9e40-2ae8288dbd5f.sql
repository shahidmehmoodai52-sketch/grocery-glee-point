
DROP FUNCTION IF EXISTS public.admin_set_tenant_status(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_set_tenant_expiry(uuid, timestamptz);

CREATE TABLE IF NOT EXISTS public.admin_staff (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_staff_permissions (
  user_id uuid NOT NULL REFERENCES public.admin_staff(user_id) ON DELETE CASCADE,
  perm text NOT NULL,
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, perm)
);

GRANT SELECT ON public.admin_staff TO authenticated;
GRANT SELECT ON public.admin_staff_permissions TO authenticated;
GRANT ALL ON public.admin_staff TO service_role;
GRANT ALL ON public.admin_staff_permissions TO service_role;

ALTER TABLE public.admin_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_staff_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admin manages admin_staff" ON public.admin_staff;
CREATE POLICY "super admin manages admin_staff" ON public.admin_staff FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "staff reads own admin_staff row" ON public.admin_staff;
CREATE POLICY "staff reads own admin_staff row" ON public.admin_staff FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "super admin manages admin_staff_permissions" ON public.admin_staff_permissions;
CREATE POLICY "super admin manages admin_staff_permissions" ON public.admin_staff_permissions FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "staff reads own admin permissions" ON public.admin_staff_permissions;
CREATE POLICY "staff reads own admin permissions" ON public.admin_staff_permissions FOR SELECT USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_admin_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_super_admin(_user_id) OR EXISTS (SELECT 1 FROM public.admin_staff WHERE user_id = _user_id); $$;

CREATE OR REPLACE FUNCTION public.admin_has_perm(_user_id uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_super_admin(_user_id) OR EXISTS (SELECT 1 FROM public.admin_staff_permissions WHERE user_id = _user_id AND perm = _perm); $$;

CREATE OR REPLACE FUNCTION public.am_i_admin_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_admin_staff(auth.uid()); $$;

CREATE OR REPLACE FUNCTION public.my_admin_perms()
RETURNS TABLE(perm text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT perm FROM public.admin_staff_permissions WHERE user_id = auth.uid()
  UNION
  SELECT unnest(ARRAY['shops.view','shops.approve','shops.suspend','shops.set_expiry','shops.reset_password','shops.delete'])
    WHERE public.is_super_admin(auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_has_perm(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.am_i_admin_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_admin_perms() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_tenants()
RETURNS TABLE(id uuid, name text, slug text, status text, plan text, owner_id uuid, owner_name text, owner_email text, member_count integer, product_count integer, sales_count integer, sales_total numeric, subscription_status text, subscription_expires_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
    t.created_at
  FROM public.tenants t
  LEFT JOIN public.profiles p ON p.id = t.owner_id
  LEFT JOIN auth.users u ON u.id = t.owner_id
  ORDER BY t.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.admin_recent_errors(_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, tenant_id uuid, user_id uuid, error_type text, error_message text, page_or_module text, stack_trace text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY SELECT e.id, e.tenant_id, e.user_id, e.error_type, e.error_message, e.page_or_module, e.stack_trace, e.created_at
    FROM public.application_errors e ORDER BY e.created_at DESC LIMIT COALESCE(_limit, 100);
END $$;

CREATE OR REPLACE FUNCTION public.admin_security_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _r jsonb;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT jsonb_build_object(
    'failed_logins_24h', (SELECT COUNT(*) FROM public.security_events WHERE event_type='failed_login' AND created_at > now() - interval '24 hours'),
    'critical_24h', (SELECT COUNT(*) FROM public.security_events WHERE severity='critical' AND created_at > now() - interval '24 hours'),
    'total_24h', (SELECT COUNT(*) FROM public.security_events WHERE created_at > now() - interval '24 hours'),
    'active_blocks', (SELECT COUNT(*) FROM public.security_blocklist WHERE (expires_at IS NULL OR expires_at > now())),
    'unique_ips_24h', (SELECT COUNT(DISTINCT ip_address) FROM public.security_events WHERE created_at > now() - interval '24 hours')
  ) INTO _r;
  RETURN _r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_tenant_status(_tenant_id uuid, _status text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _perm text;
BEGIN
  IF _status = 'active' THEN _perm := 'shops.approve';
  ELSIF _status IN ('suspended','archived') THEN _perm := 'shops.suspend';
  ELSE _perm := 'shops.approve'; END IF;
  IF NOT public.admin_has_perm(auth.uid(), _perm) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE public.tenants SET status = _status, updated_at = now() WHERE id = _tenant_id;
  INSERT INTO public.audit_logs(tenant_id, user_id, action, table_name, record_id, new_data)
  VALUES (_tenant_id, auth.uid(), 'UPDATE', 'tenants', _tenant_id,
    jsonb_build_object('status', _status, 'reason', _reason, 'admin_action', 'tenant.status'));
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_tenant_expiry(_tenant_id uuid, _expires_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.set_expiry') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id) THEN
    UPDATE public.tenant_subscriptions SET expires_at = _expires_at, updated_at = now()
      WHERE id = (SELECT id FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id ORDER BY started_at DESC LIMIT 1);
  ELSE
    INSERT INTO public.tenant_subscriptions(tenant_id, status, started_at, expires_at)
    VALUES (_tenant_id, 'trial', now(), _expires_at);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_delete_tenant(_tenant_id uuid, _confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _tenant_name text; _table record;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.delete') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT name INTO _tenant_name FROM public.tenants WHERE id = _tenant_id;
  IF _tenant_name IS NULL THEN RAISE EXCEPTION 'Shop not found'; END IF;
  IF _confirm IS DISTINCT FROM _tenant_name THEN RAISE EXCEPTION 'Confirmation text does not match shop name'; END IF;
  INSERT INTO public.audit_logs(tenant_id, user_id, action, table_name, record_id, old_data, new_data)
  VALUES (_tenant_id, auth.uid(), 'DELETE', 'tenants', _tenant_id,
    jsonb_build_object('name', _tenant_name, 'admin_action', 'tenant.deleted'), NULL);
  FOR _table IN
    SELECT c.table_schema, c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
      AND c.table_name NOT IN ('tenants','audit_logs') AND t.table_type = 'BASE TABLE'
    GROUP BY c.table_schema, c.table_name
    ORDER BY CASE c.table_name
      WHEN 'sale_return_items' THEN 1 WHEN 'sale_returns' THEN 2
      WHEN 'sale_items' THEN 3 WHEN 'sales' THEN 4
      WHEN 'purchase_return_items' THEN 5 WHEN 'purchase_returns' THEN 6
      WHEN 'purchase_items' THEN 7 WHEN 'purchases' THEN 8
      WHEN 'stock_count_items' THEN 9 WHEN 'stock_count_sessions' THEN 10
      WHEN 'product_barcodes' THEN 11 WHEN 'product_batches' THEN 12
      WHEN 'products' THEN 13 WHEN 'tenant_members' THEN 99
      ELSE 50 END, c.table_name
  LOOP
    EXECUTE format('DELETE FROM %I.%I WHERE tenant_id = $1', _table.table_schema, _table.table_name) USING _tenant_id;
  END LOOP;
  DELETE FROM public.tenants WHERE id = _tenant_id;
  RETURN jsonb_build_object('ok', true, 'name', _tenant_name);
END $$;
