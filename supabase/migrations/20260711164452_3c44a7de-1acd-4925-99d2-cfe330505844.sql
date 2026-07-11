ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS library_show_sell_price boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS library_show_cost_price boolean NOT NULL DEFAULT true;