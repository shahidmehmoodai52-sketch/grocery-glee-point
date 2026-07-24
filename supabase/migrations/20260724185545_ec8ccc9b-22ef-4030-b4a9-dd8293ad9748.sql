
CREATE TABLE public.asset_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT current_tenant_id() REFERENCES public.tenants(id),
  name TEXT NOT NULL,
  icon TEXT,
  notes TEXT,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_categories TO authenticated;
GRANT ALL ON public.asset_categories TO service_role;
ALTER TABLE public.asset_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asset_cats_select" ON public.asset_categories FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "asset_cats_insert" ON public.asset_categories FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "asset_cats_update" ON public.asset_categories FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "asset_cats_delete" ON public.asset_categories FOR DELETE TO authenticated USING (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT current_tenant_id() REFERENCES public.tenants(id),
  category_id UUID REFERENCES public.asset_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  brand TEXT,
  model_number TEXT,
  serial_number TEXT,
  quantity NUMERIC(18,2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  purchase_date DATE,
  purchase_price NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  current_value NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (current_value >= 0),
  condition TEXT NOT NULL DEFAULT 'good',
  location TEXT,
  warranty_expiry DATE,
  supplier TEXT,
  image_url TEXT,
  notes TEXT,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assets_tenant_idx ON public.assets(tenant_id);
CREATE INDEX assets_tenant_category_idx ON public.assets(tenant_id, category_id);
CREATE INDEX assets_tenant_created_idx ON public.assets(tenant_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assets_select" ON public.assets FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "assets_insert" ON public.assets FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "assets_update" ON public.assets FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "assets_delete" ON public.assets FOR DELETE TO authenticated USING (tenant_id = current_tenant_id() AND has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_asset_categories_updated_at
  BEFORE UPDATE ON public.asset_categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_assets_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
