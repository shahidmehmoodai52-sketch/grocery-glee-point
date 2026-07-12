UPDATE public.user_roles ur
SET role = 'admin'::public.app_role
FROM public.tenants t
WHERE t.owner_id = ur.user_id
  AND t.status = 'active'
  AND ur.role = 'cashier'::public.app_role;

INSERT INTO public.user_roles (user_id, role)
SELECT t.owner_id, 'admin'::public.app_role
FROM public.tenants t
WHERE t.status = 'active'
  AND t.owner_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = t.owner_id
  )
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_set_tenant_status(_tenant_id uuid, _status text, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_super_admin(v_uid) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _status NOT IN ('active','suspended','pending','archived') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  UPDATE public.tenants SET status = _status, updated_at = now() WHERE id = _tenant_id
  RETURNING owner_id INTO v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenant not found'; END IF;

  IF _status = 'active' AND v_owner IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_owner, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    DELETE FROM public.user_roles
    WHERE user_id = v_owner
      AND role = 'cashier'::public.app_role
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = v_owner
          AND ur.role = 'admin'::public.app_role
      );
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, table_name, record_id, new_data)
  VALUES (_tenant_id, v_uid, 'ADMIN_SET_STATUS', 'tenants', _tenant_id,
          jsonb_build_object('status', _status, 'reason', _reason));
  RETURN _tenant_id;
END $$;