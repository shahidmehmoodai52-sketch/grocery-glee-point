
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS low_stock_threshold numeric NOT NULL DEFAULT 5;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS low_stock_threshold numeric NOT NULL DEFAULT 5;
