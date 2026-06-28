CREATE TABLE public.product_barcodes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_barcodes_barcode_key ON public.product_barcodes (barcode);
CREATE INDEX product_barcodes_product_id_idx ON public.product_barcodes (product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_barcodes TO authenticated;
GRANT ALL ON public.product_barcodes TO service_role;

ALTER TABLE public.product_barcodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "barcodes_select_auth" ON public.product_barcodes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "barcodes_admin_insert" ON public.product_barcodes
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "barcodes_admin_update" ON public.product_barcodes
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "barcodes_admin_delete" ON public.product_barcodes
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Seed from existing single barcodes
INSERT INTO public.product_barcodes (product_id, barcode)
SELECT id, barcode FROM public.products
WHERE barcode IS NOT NULL AND barcode <> ''
ON CONFLICT (barcode) DO NOTHING;