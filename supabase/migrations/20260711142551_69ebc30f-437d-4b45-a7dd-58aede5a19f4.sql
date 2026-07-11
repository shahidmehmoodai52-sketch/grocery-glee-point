CREATE OR REPLACE FUNCTION public.admin_delete_tenant(_tenant_id uuid, _confirm text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant_name text;
  _table record;
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

  INSERT INTO public.audit_logs(tenant_id, user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    _tenant_id,
    auth.uid(),
    'tenant.deleted',
    'tenants',
    _tenant_id,
    jsonb_build_object('name', _tenant_name),
    NULL
  );

  FOR _table IN
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'tenant_id'
      AND table_name NOT IN ('tenants', 'audit_logs')
    GROUP BY table_schema, table_name
    ORDER BY CASE table_name
      WHEN 'sale_return_items' THEN 1
      WHEN 'sale_returns' THEN 2
      WHEN 'sale_items' THEN 3
      WHEN 'sales' THEN 4
      WHEN 'purchase_return_items' THEN 5
      WHEN 'purchase_returns' THEN 6
      WHEN 'purchase_items' THEN 7
      WHEN 'purchases' THEN 8
      WHEN 'stock_count_items' THEN 9
      WHEN 'stock_count_sessions' THEN 10
      WHEN 'product_barcodes' THEN 11
      WHEN 'product_batches' THEN 12
      WHEN 'products' THEN 13
      WHEN 'tenant_members' THEN 99
      ELSE 50
    END,
    table_name
  LOOP
    BEGIN
      EXECUTE format('DELETE FROM %I.%I WHERE tenant_id = $1', _table.table_schema, _table.table_name)
      USING _tenant_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Failed deleting shop data from %.%: %', _table.table_schema, _table.table_name, SQLERRM;
    END;
  END LOOP;

  DELETE FROM public.tenants WHERE id = _tenant_id;

  RETURN jsonb_build_object('ok', true, 'name', _tenant_name);
END;
$function$;