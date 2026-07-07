-- Sprint 4B Task 1: Tenant-scoped RESTRICTIVE RLS policies (additive)
-- Restrictive policies AND with existing permissive policies, so all existing
-- role/permission behavior is preserved and tenant isolation becomes mandatory.

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'customers','suppliers','expense_persons','expenses','party_payments',
    'products','product_barcodes','import_batches',
    'purchases','purchase_items','purchase_returns','purchase_return_items',
    'sales','sale_items','sale_returns','sale_return_items',
    'store_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    -- SELECT
    EXECUTE format($f$
      DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;
      CREATE POLICY tenant_isolation_select ON public.%I
        AS RESTRICTIVE FOR SELECT TO authenticated
        USING (tenant_id = public.current_tenant_id());
    $f$, t, t);

    -- INSERT
    EXECUTE format($f$
      DROP POLICY IF EXISTS tenant_isolation_insert ON public.%I;
      CREATE POLICY tenant_isolation_insert ON public.%I
        AS RESTRICTIVE FOR INSERT TO authenticated
        WITH CHECK (tenant_id = public.current_tenant_id());
    $f$, t, t);

    -- UPDATE
    EXECUTE format($f$
      DROP POLICY IF EXISTS tenant_isolation_update ON public.%I;
      CREATE POLICY tenant_isolation_update ON public.%I
        AS RESTRICTIVE FOR UPDATE TO authenticated
        USING (tenant_id = public.current_tenant_id())
        WITH CHECK (tenant_id = public.current_tenant_id());
    $f$, t, t);

    -- DELETE
    EXECUTE format($f$
      DROP POLICY IF EXISTS tenant_isolation_delete ON public.%I;
      CREATE POLICY tenant_isolation_delete ON public.%I
        AS RESTRICTIVE FOR DELETE TO authenticated
        USING (tenant_id = public.current_tenant_id());
    $f$, t, t);
  END LOOP;
END $$;