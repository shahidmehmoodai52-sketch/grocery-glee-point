-- Change FK on audit_logs.tenant_id to ON DELETE SET NULL to preserve history
ALTER TABLE public.audit_logs
DROP CONSTRAINT IF EXISTS audit_logs_tenant_id_fkey,
ADD CONSTRAINT audit_logs_tenant_id_fkey 
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) 
    ON DELETE SET NULL;

-- Revoke execute from public for log_admin_action
REVOKE EXECUTE ON FUNCTION public.log_admin_action FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.log_admin_action TO service_role;

-- Update admin_delete_tenant to skip audit_logs and log action
CREATE OR REPLACE FUNCTION public.admin_delete_tenant(_tenant_id uuid, _confirm text)
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

   -- Log the start of deletion (only on first call if resumable, or every time)
   -- Since it's resumable, we log once if it's the first step
   
   FOR _table IN
     SELECT c.table_schema, c.table_name
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'tenant_id'
       AND c.table_name <> 'tenants'
       AND c.table_name <> 'audit_logs' -- EXPLICITLY SKIP AUDIT LOGS
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

   -- Final log before tenant is gone
   PERFORM public.log_admin_action(
     'TENANT_DELETE',
     _tenant_id,
     'tenant',
     _tenant_id::text,
     'Shop permanently deleted'
   );

   DELETE FROM public.tenants WHERE id = _tenant_id;

   RETURN jsonb_build_object('ok', true, 'done', true, 'name', _tenant_name, 'deleted_rows', 0);
 END;
 $function$;

-- Update admin_set_tenant_expiry to log action
CREATE OR REPLACE FUNCTION public.admin_set_tenant_expiry(_tenant_id uuid, _expires_at timestamp with time zone)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 DECLARE
   _old_expiry timestamp with time zone;
 BEGIN
   IF NOT public.admin_has_perm(auth.uid(), 'shops.set_expiry') THEN RAISE EXCEPTION 'Forbidden'; END IF;
   
   SELECT expires_at INTO _old_expiry FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id ORDER BY started_at DESC LIMIT 1;
   
   IF EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id) THEN
     UPDATE public.tenant_subscriptions SET expires_at = _expires_at, updated_at = now()
       WHERE id = (SELECT id FROM public.tenant_subscriptions WHERE tenant_id = _tenant_id ORDER BY started_at DESC LIMIT 1);
   ELSE
     INSERT INTO public.tenant_subscriptions(tenant_id, status, started_at, expires_at)
     VALUES (_tenant_id, 'trial', now(), _expires_at);
   END IF;

   PERFORM public.log_admin_action(
     'TENANT_SET_EXPIRY',
     _tenant_id,
     'tenant',
     _tenant_id::text,
     NULL,
     jsonb_build_object('expires_at', _old_expiry),
     jsonb_build_object('expires_at', _expires_at)
   );
 END $function$;

-- Update admin_resolve_error to log action
CREATE OR REPLACE FUNCTION public.admin_resolve_error(_id uuid, _note text DEFAULT NULL::text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 DECLARE
   _tenant_id uuid;
 BEGIN
   IF NOT public.is_super_admin(auth.uid()) THEN
     RAISE EXCEPTION 'Forbidden';
   END IF;
   
   SELECT tenant_id INTO _tenant_id FROM public.application_errors WHERE id = _id;
   
   UPDATE public.application_errors
      SET resolved_at = now(),
          resolved_by = auth.uid(),
          resolution_note = COALESCE(_note, resolution_note)
    WHERE id = _id;

   PERFORM public.log_admin_action(
     'ERROR_RESOLVE',
     _tenant_id,
     'application_errors',
     _id::text,
     _note
   );
 END;
 $function$;

-- Update admin_resolve_errors_bulk to log action
CREATE OR REPLACE FUNCTION public.admin_resolve_errors_bulk(_tenant_id uuid DEFAULT NULL::uuid, _error_type text DEFAULT NULL::text, _note text DEFAULT NULL::text)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 DECLARE
   n integer;
 BEGIN
   IF NOT public.is_super_admin(auth.uid()) THEN
     RAISE EXCEPTION 'Forbidden';
   END IF;
   
   UPDATE public.application_errors
      SET resolved_at = now(),
          resolved_by = auth.uid(),
          resolution_note = COALESCE(_note, resolution_note)
    WHERE resolved_at IS NULL
      AND (_tenant_id IS NULL OR tenant_id = _tenant_id)
      AND (_error_type IS NULL OR error_type = _error_type);
   
   GET DIAGNOSTICS n = ROW_COUNT;

   PERFORM public.log_admin_action(
     'ERROR_RESOLVE_BULK',
     _tenant_id,
     'application_errors',
     NULL,
     _note,
     NULL,
     jsonb_build_object('count', n, 'error_type', _error_type)
   );
   
   RETURN n;
 END;
 $function$;

-- Update admin_block_identifier to log action
CREATE OR REPLACE FUNCTION public.admin_block_identifier(_kind text, _value text, _reason text, _hours integer DEFAULT NULL::integer)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 DECLARE _id uuid;
 BEGIN
   IF NOT public.has_role(auth.uid(), 'super_admin') THEN
     RAISE EXCEPTION 'forbidden';
   END IF;
   
   INSERT INTO public.security_blocks (kind, value, reason, expires_at)
   VALUES (_kind, _value, _reason, CASE WHEN _hours IS NOT NULL THEN now() + (_hours || ' hours')::interval ELSE NULL END)
   RETURNING id INTO _id;

   PERFORM public.log_admin_action(
     'SECURITY_BLOCK',
     NULL,
     'security_blocks',
     _id::text,
     _reason,
     NULL,
     jsonb_build_object('kind', _kind, 'value', _value, 'expires_at', CASE WHEN _hours IS NOT NULL THEN now() + (_hours || ' hours')::interval ELSE NULL END)
   );

   RETURN _id;
 END;
 $function$;
