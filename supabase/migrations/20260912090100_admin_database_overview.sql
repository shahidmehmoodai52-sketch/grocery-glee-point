-- New admin-panel "Database" view: overall size, top tables by size, and a
-- per-tenant usage breakdown (row counts across every tenant-scoped table),
-- so admins can see how much of the database each shop actually accounts
-- for and spot one that's grown unusually large. Per-shop *health* (expired
-- subscription, over seat/product limit, no recent activity, etc.) is
-- intentionally NOT recomputed here -- TenantsTab's tenantHealthWarning()
-- already derives that, honestly, from admin_list_tenants' existing
-- columns, and this view is joined against that same tenant list in the
-- frontend rather than inventing a second, parallel health signal.
--
-- Cost/safety, read carefully since this runs against the real production
-- database:
--   - db size / per-table size come from pg_database_size /
--     pg_total_relation_size -- catalog metadata lookups, O(1), never scan
--     a single row of table data.
--   - per-tenant row counts use one `GROUP BY tenant_id` pass per
--     tenant-scoped table (discovered the same way admin_delete_tenant
--     already discovers "every table that belongs to a tenant" --
--     information_schema.columns where column_name = 'tenant_id'), i.e. a
--     FIXED number of single-pass scans (one per table) regardless of how
--     many tenants exist -- strictly cheaper than admin_list_tenants'
--     existing per-tenant subqueries (product_count/sales_count/
--     sales_total), which already run one scan PER TENANT PER COLUMN in
--     production today. Verified on tillix-migration-test (8 tenants, ~46MB
--     largest table) that this returns in well under 100ms.
--
-- Verified on tillix-migration-test: forbidden for a plain tenant owner;
-- succeeds for admin_staff granted only 'shops.view'; tenant_row_counts
-- total for a known test tenant matched a manual COUNT(*) sum across its
-- tables; no rows were modified (read-only function, no writes issued).

CREATE OR REPLACE FUNCTION public.admin_database_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_db_size_bytes bigint;
  v_table_count int;
  v_tables jsonb := '[]'::jsonb;
  v_tenant_rows jsonb := '{}'::jsonb;
  v_table record;
  v_row record;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT pg_database_size(current_database()) INTO v_db_size_bytes;

  SELECT COUNT(*) INTO v_table_count
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r';

  FOR v_row IN
    SELECT c.relname AS name, pg_total_relation_size(c.oid) AS size_bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 20
  LOOP
    v_tables := v_tables || jsonb_build_object('name', v_row.name, 'size_bytes', v_row.size_bytes);
  END LOOP;

  FOR v_table IN
    SELECT DISTINCT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
      AND c.table_name <> 'tenants' AND t.table_type = 'BASE TABLE'
  LOOP
    FOR v_row IN EXECUTE format(
      'SELECT tenant_id, COUNT(*) AS cnt FROM public.%I WHERE tenant_id IS NOT NULL GROUP BY tenant_id',
      v_table.table_name
    )
    LOOP
      v_tenant_rows := jsonb_set(
        v_tenant_rows,
        ARRAY[v_row.tenant_id::text],
        to_jsonb(COALESCE((v_tenant_rows -> v_row.tenant_id::text)::bigint, 0) + v_row.cnt)
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'db_size_bytes', v_db_size_bytes,
    'table_count', v_table_count,
    'tables', v_tables,
    'tenant_row_counts', v_tenant_rows,
    'generated_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_database_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_database_overview() TO authenticated;
