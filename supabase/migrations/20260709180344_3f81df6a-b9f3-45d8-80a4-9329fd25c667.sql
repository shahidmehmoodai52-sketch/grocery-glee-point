
-- 1) New signups create tenants in 'pending' status (first user's tenant stays active).
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_count      int;
  v_tenant_id       uuid;
  v_email           text := lower(COALESCE(NEW.email, ''));
  v_full_name       text := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);
  v_tenant_name     text := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'tenant_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'business_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)) || '''s Shop'
  );
  v_has_invitation  boolean := false;
  v_new_status      text := 'pending';
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, v_full_name)
  ON CONFLICT (id) DO NOTHING;

  SELECT COUNT(*) INTO v_user_count FROM auth.users;
  IF v_user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
    v_new_status := 'active';
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'cashier') ON CONFLICT DO NOTHING;
  END IF;

  IF v_email <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_invitations
      WHERE lower(email) = v_email AND accepted_at IS NULL AND expires_at > now()
    ) INTO v_has_invitation;
  END IF;
  IF v_has_invitation THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_members WHERE user_id = NEW.id) THEN RETURN NEW; END IF;

  INSERT INTO public.tenants (name, owner_id, status)
  VALUES (v_tenant_name, NEW.id, v_new_status)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_members (tenant_id, user_id, role)
  VALUES (v_tenant_id, NEW.id, 'owner')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $function$;

-- 2) Admin RPC: change / set a tenant's active subscription plan and expiry.
CREATE OR REPLACE FUNCTION public.admin_set_tenant_plan(
  _tenant_id uuid,
  _plan_id uuid,
  _expires_at timestamptz DEFAULT NULL,
  _status text DEFAULT 'active'
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE v_plan_name text;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _status NOT IN ('trialing','active','past_due','cancelled') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;
  SELECT name INTO v_plan_name FROM public.subscription_plans WHERE id = _plan_id;
  IF v_plan_name IS NULL THEN RAISE EXCEPTION 'Plan not found'; END IF;

  -- Retire any currently-active subscription for this tenant
  UPDATE public.tenant_subscriptions
     SET status = 'cancelled', updated_at = now()
   WHERE tenant_id = _tenant_id
     AND status IN ('trialing','active','past_due');

  INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, started_at, expires_at)
  VALUES (_tenant_id, _plan_id, _status, now(), _expires_at);

  UPDATE public.tenants SET plan = v_plan_name, updated_at = now() WHERE id = _tenant_id;
END $$;

-- 3) Deep shop analytics for admin panel.
CREATE OR REPLACE FUNCTION public.admin_shop_analytics(
  _tenant_id uuid,
  _from date DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date,
  _to date DEFAULT CURRENT_DATE
) RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_from timestamptz := _from::timestamptz;
  v_to timestamptz := (_to + 1)::timestamptz;
  v_out jsonb;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;

  WITH daily AS (
    SELECT date_trunc('day', created_at)::date AS day,
           COUNT(*) AS orders,
           COALESCE(SUM(total),0) AS revenue,
           COALESCE(SUM(cost_total),0) AS cost
      FROM public.sales
     WHERE tenant_id = _tenant_id AND created_at >= v_from AND created_at < v_to
     GROUP BY 1 ORDER BY 1
  ),
  top_products AS (
    SELECT si.name,
           SUM(si.qty) AS qty,
           SUM(si.line_total) AS revenue
      FROM public.sale_items si
      JOIN public.sales s ON s.id = si.sale_id
     WHERE s.tenant_id = _tenant_id AND s.created_at >= v_from AND s.created_at < v_to
     GROUP BY si.name
     ORDER BY revenue DESC
     LIMIT 10
  ),
  by_method AS (
    SELECT COALESCE(payment_method,'unknown') AS method,
           COUNT(*) AS orders,
           COALESCE(SUM(total),0) AS total
      FROM public.sales
     WHERE tenant_id = _tenant_id AND created_at >= v_from AND created_at < v_to
     GROUP BY 1 ORDER BY total DESC
  ),
  low_stock AS (
    SELECT COUNT(*) AS c FROM public.products
     WHERE tenant_id = _tenant_id AND is_active = true
       AND min_stock IS NOT NULL AND stock <= min_stock
  ),
  expenses_agg AS (
    SELECT COALESCE(SUM(amount),0) AS total FROM public.expenses
     WHERE tenant_id = _tenant_id AND created_at >= v_from AND created_at < v_to
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', _from, 'to', _to),
    'daily', COALESCE((SELECT jsonb_agg(to_jsonb(daily.*)) FROM daily), '[]'::jsonb),
    'top_products', COALESCE((SELECT jsonb_agg(to_jsonb(top_products.*)) FROM top_products), '[]'::jsonb),
    'by_method', COALESCE((SELECT jsonb_agg(to_jsonb(by_method.*)) FROM by_method), '[]'::jsonb),
    'low_stock', (SELECT c FROM low_stock),
    'expenses_total', (SELECT total FROM expenses_agg)
  ) INTO v_out;

  RETURN v_out;
END $$;

-- 4) Admin RPC: fetch recent audit log for one tenant.
CREATE OR REPLACE FUNCTION public.admin_tenant_audit(_tenant_id uuid, _limit int DEFAULT 100)
RETURNS SETOF public.audit_logs
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.audit_logs
    WHERE tenant_id = _tenant_id
    ORDER BY created_at DESC
    LIMIT COALESCE(_limit, 100);
END $$;
