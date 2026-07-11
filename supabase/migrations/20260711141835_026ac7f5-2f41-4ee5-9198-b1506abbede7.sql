CREATE OR REPLACE FUNCTION public.admin_delete_tenant(_tenant_id uuid, _confirm text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant_name text;
  _deleted jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: super admin only';
  END IF;

  SELECT name INTO _tenant_name FROM public.tenants WHERE id = _tenant_id;
  IF _tenant_name IS NULL THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;
  IF _confirm IS DISTINCT FROM _tenant_name THEN
    RAISE EXCEPTION 'Confirmation text does not match shop name';
  END IF;

  -- Delete children that don't cascade (confdeltype = 'a').
  DELETE FROM public.sale_return_items      WHERE tenant_id = _tenant_id;
  DELETE FROM public.sale_returns           WHERE tenant_id = _tenant_id;
  DELETE FROM public.sale_items             WHERE tenant_id = _tenant_id;
  DELETE FROM public.sales                  WHERE tenant_id = _tenant_id;
  DELETE FROM public.purchase_return_items  WHERE tenant_id = _tenant_id;
  DELETE FROM public.purchase_returns       WHERE tenant_id = _tenant_id;
  DELETE FROM public.purchase_items         WHERE tenant_id = _tenant_id;
  DELETE FROM public.purchases              WHERE tenant_id = _tenant_id;
  DELETE FROM public.party_payments         WHERE tenant_id = _tenant_id;
  DELETE FROM public.expenses               WHERE tenant_id = _tenant_id;
  DELETE FROM public.expense_persons        WHERE tenant_id = _tenant_id;
  DELETE FROM public.import_batches         WHERE tenant_id = _tenant_id;
  DELETE FROM public.product_barcodes       WHERE tenant_id = _tenant_id;
  DELETE FROM public.products               WHERE tenant_id = _tenant_id;
  DELETE FROM public.customers              WHERE tenant_id = _tenant_id;
  DELETE FROM public.suppliers              WHERE tenant_id = _tenant_id;
  DELETE FROM public.store_settings         WHERE tenant_id = _tenant_id;

  -- Remove memberships explicitly while running as the verified platform admin,
  -- so tenant deletion is not blocked by the normal "last owner" guardrail.
  DELETE FROM public.tenant_user_permissions WHERE tenant_id = _tenant_id;
  DELETE FROM public.tenant_role_permissions WHERE tenant_id = _tenant_id;
  DELETE FROM public.tenant_invitations      WHERE tenant_id = _tenant_id;
  DELETE FROM public.tenant_members          WHERE tenant_id = _tenant_id;

  -- Global products contributed by this tenant: null the reference (fk = 'n'/SET NULL already).

  -- Finally delete the tenant itself; remaining tables cascade automatically.
  DELETE FROM public.tenants WHERE id = _tenant_id;

  INSERT INTO public.audit_logs(tenant_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (NULL, auth.uid(), 'tenant.deleted', 'tenant', _tenant_id, jsonb_build_object('name', _tenant_name));

  RETURN jsonb_build_object('ok', true, 'name', _tenant_name);
END;
$function$;