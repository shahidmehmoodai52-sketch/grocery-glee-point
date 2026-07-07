-- Sprint 4B Task 2: additive composite tenant-aware indexes.
-- All CREATE INDEX IF NOT EXISTS — safe to re-run, non-destructive.

-- Products: barcode + SKU lookups per tenant
CREATE INDEX IF NOT EXISTS products_tenant_barcode_idx  ON public.products      (tenant_id, barcode);
CREATE INDEX IF NOT EXISTS products_tenant_sku_idx      ON public.products      (tenant_id, sku);
CREATE INDEX IF NOT EXISTS products_tenant_active_idx   ON public.products      (tenant_id, is_active);

-- Product barcodes: scanner lookup per tenant
CREATE INDEX IF NOT EXISTS product_barcodes_tenant_barcode_idx ON public.product_barcodes (tenant_id, barcode);

-- Sales: invoice lookup + dashboard time-range + customer FK
CREATE INDEX IF NOT EXISTS sales_tenant_invoice_idx     ON public.sales         (tenant_id, invoice_no);
CREATE INDEX IF NOT EXISTS sales_tenant_created_idx     ON public.sales         (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_customer_idx           ON public.sales         (customer_id);
CREATE INDEX IF NOT EXISTS sales_tenant_customer_idx    ON public.sales         (tenant_id, customer_id);

-- Purchases: invoice lookup + time-range + supplier FK
CREATE INDEX IF NOT EXISTS purchases_tenant_invoice_idx ON public.purchases     (tenant_id, invoice_no);
CREATE INDEX IF NOT EXISTS purchases_tenant_created_idx ON public.purchases     (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchases_supplier_idx       ON public.purchases     (supplier_id);
CREATE INDEX IF NOT EXISTS purchases_tenant_supplier_idx ON public.purchases    (tenant_id, supplier_id);

-- Sale returns
CREATE INDEX IF NOT EXISTS sale_returns_tenant_no_idx      ON public.sale_returns (tenant_id, return_no);
CREATE INDEX IF NOT EXISTS sale_returns_tenant_created_idx ON public.sale_returns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sale_returns_sale_idx           ON public.sale_returns (sale_id);
CREATE INDEX IF NOT EXISTS sale_returns_customer_idx       ON public.sale_returns (customer_id);

-- Purchase returns
CREATE INDEX IF NOT EXISTS purchase_returns_tenant_no_idx      ON public.purchase_returns (tenant_id, return_no);
CREATE INDEX IF NOT EXISTS purchase_returns_tenant_created_idx ON public.purchase_returns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_returns_purchase_idx       ON public.purchase_returns (purchase_id);
CREATE INDEX IF NOT EXISTS purchase_returns_supplier_idx       ON public.purchase_returns (supplier_id);

-- Expenses: date scans per tenant
CREATE INDEX IF NOT EXISTS expenses_tenant_date_idx    ON public.expenses      (tenant_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS expenses_tenant_created_idx ON public.expenses      (tenant_id, created_at DESC);

-- Party payments: per-tenant party ledger scans
CREATE INDEX IF NOT EXISTS party_payments_tenant_party_idx ON public.party_payments (tenant_id, party_type, party_id, created_at DESC);

-- Line-item child tables: tenant + parent (accelerates report joins under RLS)
CREATE INDEX IF NOT EXISTS sale_items_tenant_sale_idx           ON public.sale_items          (tenant_id, sale_id);
CREATE INDEX IF NOT EXISTS purchase_items_tenant_purchase_idx   ON public.purchase_items      (tenant_id, purchase_id);
CREATE INDEX IF NOT EXISTS sale_return_items_tenant_return_idx  ON public.sale_return_items   (tenant_id, return_id);
CREATE INDEX IF NOT EXISTS purchase_return_items_tenant_return_idx ON public.purchase_return_items (tenant_id, return_id);