-- Pharmacy business-type extension: per-product pharmacy-specific fields,
-- stored in a separate 1:1 table rather than adding pharmacy-only columns
-- directly to `products`, so the core `products` table (shared by every
-- business type) never has to carry columns that are meaningless for a
-- grocery tenant. A row here only ever exists for tenants with
-- business_type = 'pharmacy'.
--
-- RLS/trigger pattern copied verbatim from product_batches (Sprint 6C) —
-- the closest existing analogue of a per-product side table. Verified on
-- tillix-migration-test: table creation, RLS enforcement, and fill_tenant_id
-- trigger all behave as expected; get_advisors reported no new issues.

CREATE TABLE IF NOT EXISTS public.pharmacy_product_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  generic_name TEXT,
  strength TEXT,
  dosage_form TEXT,
  manufacturer TEXT,
  drug_schedule TEXT,
  prescription_required BOOLEAN NOT NULL DEFAULT FALSE,
  pack_size TEXT,
  units_per_pack NUMERIC,
  base_unit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pharmacy_product_details TO authenticated;
GRANT ALL ON public.pharmacy_product_details TO service_role;
ALTER TABLE public.pharmacy_product_details ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pharmacy_product_details_tenant ON public.pharmacy_product_details(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_product_details_generic_name ON public.pharmacy_product_details(tenant_id, generic_name);

DROP POLICY IF EXISTS pharmacy_product_details_select ON public.pharmacy_product_details;
CREATE POLICY pharmacy_product_details_select ON public.pharmacy_product_details FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS pharmacy_product_details_write ON public.pharmacy_product_details;
CREATE POLICY pharmacy_product_details_write ON public.pharmacy_product_details FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP TRIGGER IF EXISTS trg_pharmacy_product_details_fill_tenant ON public.pharmacy_product_details;
CREATE TRIGGER trg_pharmacy_product_details_fill_tenant BEFORE INSERT ON public.pharmacy_product_details
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenant_id();
DROP TRIGGER IF EXISTS trg_pharmacy_product_details_touch ON public.pharmacy_product_details;
CREATE TRIGGER trg_pharmacy_product_details_touch BEFORE UPDATE ON public.pharmacy_product_details
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
