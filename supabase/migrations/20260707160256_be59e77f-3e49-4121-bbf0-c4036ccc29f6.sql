
DO $$
DECLARE
  v_tenant uuid;
  t text;
  tables text[] := ARRAY[
    'store_settings','products','product_barcodes','customers','suppliers',
    'expense_persons','expenses','sales','sale_items','sale_returns',
    'sale_return_items','purchases','purchase_items','purchase_returns',
    'purchase_return_items','party_payments','import_batches'
  ];
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'default-shop' LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Default Shop tenant not found; aborting Phase 2';
  END IF;

  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id)', t);
    EXECUTE format('UPDATE public.%I SET tenant_id = %L WHERE tenant_id IS NULL', t, v_tenant);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(tenant_id)', t || '_tenant_id_idx', t);
  END LOOP;
END $$;
