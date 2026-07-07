
-- 1. Drop global unique constraints, replace with tenant-scoped uniques
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_sku_uniq
  ON public.products (tenant_id, sku) WHERE sku IS NOT NULL;

ALTER TABLE public.product_barcodes DROP CONSTRAINT IF EXISTS product_barcodes_barcode_key;
DROP INDEX IF EXISTS public.product_barcodes_barcode_key;
CREATE UNIQUE INDEX IF NOT EXISTS product_barcodes_tenant_barcode_uniq
  ON public.product_barcodes (tenant_id, barcode) WHERE barcode IS NOT NULL;

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_invoice_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS sales_tenant_invoice_no_uniq
  ON public.sales (tenant_id, invoice_no) WHERE invoice_no IS NOT NULL;

ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_invoice_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS purchases_tenant_invoice_no_uniq
  ON public.purchases (tenant_id, invoice_no) WHERE invoice_no IS NOT NULL;

ALTER TABLE public.sale_returns DROP CONSTRAINT IF EXISTS sale_returns_return_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS sale_returns_tenant_return_no_uniq
  ON public.sale_returns (tenant_id, return_no) WHERE return_no IS NOT NULL;

ALTER TABLE public.purchase_returns DROP CONSTRAINT IF EXISTS purchase_returns_return_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_returns_tenant_return_no_uniq
  ON public.purchase_returns (tenant_id, return_no) WHERE return_no IS NOT NULL;

-- 2. Composite performance indexes
CREATE INDEX IF NOT EXISTS products_tenant_name_idx        ON public.products        (tenant_id, name);
CREATE INDEX IF NOT EXISTS products_tenant_created_idx     ON public.products        (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customers_tenant_name_idx       ON public.customers       (tenant_id, name);
CREATE INDEX IF NOT EXISTS customers_tenant_created_idx    ON public.customers       (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS suppliers_tenant_name_idx       ON public.suppliers       (tenant_id, name);
CREATE INDEX IF NOT EXISTS suppliers_tenant_created_idx    ON public.suppliers       (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS expense_persons_tenant_name_idx ON public.expense_persons (tenant_id, name);
CREATE INDEX IF NOT EXISTS sales_tenant_created_idx        ON public.sales           (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchases_tenant_created_idx    ON public.purchases       (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sale_returns_tenant_created_idx     ON public.sale_returns     (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_returns_tenant_created_idx ON public.purchase_returns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sale_items_tenant_idx           ON public.sale_items           (tenant_id);
CREATE INDEX IF NOT EXISTS purchase_items_tenant_idx       ON public.purchase_items       (tenant_id);
CREATE INDEX IF NOT EXISTS sale_return_items_tenant_idx    ON public.sale_return_items    (tenant_id);
CREATE INDEX IF NOT EXISTS purchase_return_items_tenant_idx ON public.purchase_return_items (tenant_id);

-- 3. Enforce tenant_id NOT NULL on operational tables (verified 0 NULLs)
DO $$
DECLARE
  t text;
  n bigint;
  tables text[] := ARRAY[
    'products','product_barcodes','sales','sale_items','purchases','purchase_items',
    'sale_returns','sale_return_items','purchase_returns','purchase_return_items',
    'customers','suppliers','expense_persons','expenses','party_payments',
    'store_settings','import_batches'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Abort: % has % NULL tenant_id rows', t, n;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', t);
  END LOOP;
END $$;
