-- admin_delete_tenant on production already self-healed part of an
-- audit-trail regression that shipped in
-- supabase/migrations/20260817194805_c67b00d0-5c35-4990-8044-c578e3cfb9b5.sql
-- (it now excludes audit_logs from its batch sweep, and calls
-- log_admin_action() with action 'TENANT_DELETE' right before the final
-- tenant delete) -- but that fix was made directly against the live
-- database and never captured in a tracked migration, so this file is the
-- first record of it, plus two real fixes on top:
--
-- 1. The admin-collected deletion reason (typed into the confirmation
--    dialog) was never threaded through to the log -- it always recorded
--    the hardcoded string 'Shop permanently deleted'. Add an additive
--    _reason parameter and use it when provided.
--
-- 2. audit_logs.tenant_id was still declared NOT NULL even though its FK
--    was changed to ON DELETE SET NULL (also live-only, never migrated) --
--    for any tenant with existing audit_logs rows (i.e. any tenant that
--    has ever had a product/customer/supplier/sale/purchase/payment/expense
--    inserted, updated or deleted), the final `DELETE FROM tenants` in this
--    function cannot actually complete: Postgres tries to null out those
--    rows' tenant_id to satisfy the FK action and hits the NOT NULL
--    constraint, so the whole call raises an exception and rolls back.
--    Confirmed live on both reachable databases: admin_action_log has zero
--    'TENANT_DELETE' rows and audit_logs has zero tenant_id IS NULL rows,
--    consistent with tenant deletion never having completed successfully
--    since this version of the function was deployed. Dropping NOT NULL is
--    the fix -- the FK action was already correctly chosen to preserve
--    audit history, only the column declaration didn't match it. Re-assert
--    the FK action explicitly too, so this migration is correct even when
--    replayed from scratch (e.g. a fresh Supabase branch), not just as a
--    reconciliation against already-patched live databases.

ALTER TABLE public.audit_logs ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_tenant_id_fkey;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;

-- The tracked 2-arg signature and this new 3-arg signature would otherwise
-- coexist as ambiguous overloads for a 2-argument call; drop it first.
DROP FUNCTION IF EXISTS public.admin_delete_tenant(uuid, text);

CREATE OR REPLACE FUNCTION public.admin_delete_tenant(_tenant_id uuid, _confirm text, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      AND c.table_name <> 'audit_logs' -- audit history must survive tenant deletion
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

  PERFORM public.log_admin_action(
    'TENANT_DELETE',
    _tenant_id,
    'tenant',
    _tenant_id::text,
    COALESCE(_reason, 'Shop permanently deleted')
  );

  DELETE FROM public.tenants WHERE id = _tenant_id;

  RETURN jsonb_build_object('ok', true, 'done', true, 'name', _tenant_name, 'deleted_rows', 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_tenant(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_tenant(uuid, text, text) TO authenticated;
