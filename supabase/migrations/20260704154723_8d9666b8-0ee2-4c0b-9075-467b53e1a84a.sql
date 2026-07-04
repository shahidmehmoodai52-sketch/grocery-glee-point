
-- Import batches: track each uploaded file so users can review and delete them later.
CREATE TABLE public.import_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  source TEXT NOT NULL,
  products_count INTEGER NOT NULL DEFAULT 0,
  barcodes_count INTEGER NOT NULL DEFAULT 0,
  customers_count INTEGER NOT NULL DEFAULT 0,
  suppliers_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view import batches"
  ON public.import_batches FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert import batches"
  ON public.import_batches FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update import batches"
  ON public.import_batches FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete import batches"
  ON public.import_batches FOR DELETE
  TO authenticated USING (true);

-- Tag imported rows with the batch that created them so we can delete precisely.
ALTER TABLE public.products
  ADD COLUMN import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE CASCADE;

ALTER TABLE public.product_barcodes
  ADD COLUMN import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE CASCADE;

ALTER TABLE public.customers
  ADD COLUMN import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE CASCADE;

ALTER TABLE public.suppliers
  ADD COLUMN import_batch_id UUID REFERENCES public.import_batches(id) ON DELETE CASCADE;

CREATE INDEX idx_products_import_batch ON public.products(import_batch_id);
CREATE INDEX idx_product_barcodes_import_batch ON public.product_barcodes(import_batch_id);
CREATE INDEX idx_customers_import_batch ON public.customers(import_batch_id);
CREATE INDEX idx_suppliers_import_batch ON public.suppliers(import_batch_id);
