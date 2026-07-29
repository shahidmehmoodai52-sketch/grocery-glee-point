CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON public.products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_sku_trgm_idx ON public.products USING gin (sku gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_barcode_trgm_idx ON public.products USING gin (barcode gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_tenant_category_name_idx ON public.products (tenant_id, category, name);
CREATE INDEX IF NOT EXISTS products_tenant_stock_idx ON public.products (tenant_id, stock);
CREATE INDEX IF NOT EXISTS products_tenant_sell_price_idx ON public.products (tenant_id, sell_price);
CREATE INDEX IF NOT EXISTS products_tenant_cost_price_idx ON public.products (tenant_id, cost_price);
CREATE INDEX IF NOT EXISTS products_tenant_allow_neg_idx ON public.products (tenant_id, allow_negative_stock);