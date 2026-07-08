DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'products','product_barcodes','customers','suppliers',
    'expenses','expense_persons','party_payments',
    'sales','sale_items','sale_returns','sale_return_items',
    'purchases','purchase_items','purchase_returns','purchase_return_items',
    'store_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_auth', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id())',
      t || '_select_auth', t
    );
  END LOOP;
END $$;