CREATE OR REPLACE FUNCTION public.admin_delete_tenant(_tenant_id uuid, _confirm text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_name text;
  _table record;
  _deleted_rows integer := 0;
  _batch_size integer := 2000;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.delete') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT name INTO _tenant_name
  FROM public.tenants
  WHERE id = _tenant_id;

  IF _tenant_name IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'done', true, 'name', _confirm, 'deleted_rows', 0);
  END IF;

  IF _confirm IS DISTINCT FROM _tenant_name THEN
    RAISE EXCEPTION 'Confirmation text does not match shop name';
  END IF;

  -- Each invocation removes at most one small batch and then commits. This is
  -- intentionally resumable: the client calls again until done=true.
  FOR _table IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND c.table_name <> 'tenants'
      AND t.table_type = 'BASE TABLE'
    GROUP BY c.table_schema, c.table_name
    ORDER BY CASE c.table_name
      WHEN 'sale_return_items' THEN 1
      WHEN 'purchase_return_items' THEN 2
      WHEN 'sale_items' THEN 3
      WHEN 'purchase_items' THEN 4
      WHEN 'stock_count_items' THEN 5
      WHEN 'inventory_movements' THEN 6
      WHEN 'inventory_damages' THEN 7
      WHEN 'inventory_waste' THEN 8
      WHEN 'product_barcodes' THEN 9
      WHEN 'product_batches' THEN 10
      WHEN 'cash_transactions' THEN 11
      WHEN 'party_payments' THEN 12
      WHEN 'sale_returns' THEN 13
      WHEN 'purchase_returns' THEN 14
      WHEN 'sales' THEN 15
      WHEN 'purchases' THEN 16
      WHEN 'expenses' THEN 17
      WHEN 'products' THEN 18
      WHEN 'cash_accounts' THEN 19
      WHEN 'expense_persons' THEN 20
      WHEN 'customers' THEN 21
      WHEN 'suppliers' THEN 22
      WHEN 'audit_logs' THEN 98
      WHEN 'tenant_members' THEN 99
      ELSE 50
    END, c.table_name
  LOOP
    EXECUTE format(
      'WITH batch AS (
         SELECT ctid FROM %I.%I WHERE tenant_id = $1 LIMIT $2
       )
       DELETE FROM %I.%I AS target
       USING batch
       WHERE target.ctid = batch.ctid',
      _table.table_schema, _table.table_name,
      _table.table_schema, _table.table_name
    )
    USING _tenant_id, _batch_size;

    GET DIAGNOSTICS _deleted_rows = ROW_COUNT;

    IF _deleted_rows > 0 THEN
      RETURN jsonb_build_object(
        'ok', true,
        'done', false,
        'name', _tenant_name,
        'table', _table.table_name,
        'deleted_rows', _deleted_rows
      );
    END IF;
  END LOOP;

  -- Avoid a potentially expensive SET NULL scan during the final tenant delete.
  UPDATE public.global_products
  SET contributed_by_tenant = NULL
  WHERE contributed_by_tenant = _tenant_id;

  DELETE FROM public.tenants WHERE id = _tenant_id;

  RETURN jsonb_build_object('ok', true, 'done', true, 'name', _tenant_name, 'deleted_rows', 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_tenant(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_tenant(uuid, text) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_global_products_contributed_by_tenant
ON public.global_products(contributed_by_tenant)
WHERE contributed_by_tenant IS NOT NULL;