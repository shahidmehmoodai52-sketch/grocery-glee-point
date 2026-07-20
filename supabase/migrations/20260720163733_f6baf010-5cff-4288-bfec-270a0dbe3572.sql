
CREATE OR REPLACE FUNCTION public.fanout_approved_global_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    FOR t IN SELECT id FROM public.tenants LOOP
      -- Skip if this tenant already has a product matching by barcode or item code (sku)
      IF EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.tenant_id = t.id
          AND (
            (NEW.barcode IS NOT NULL AND p.barcode = NEW.barcode)
            OR (NEW.item_code IS NOT NULL AND p.sku = NEW.item_code)
          )
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.products
        (tenant_id, name, sku, barcode, category, unit,
         cost_price, sell_price, stock, is_active)
      VALUES
        (t.id, NEW.name, NEW.item_code, NEW.barcode, NEW.category,
         COALESCE(NEW.unit, 'pcs'),
         COALESCE(NEW.default_cost_price, 0),
         COALESCE(NEW.default_sell_price, 0),
         0, true);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fanout_approved_global_product ON public.global_products;
CREATE TRIGGER trg_fanout_approved_global_product
AFTER UPDATE ON public.global_products
FOR EACH ROW
EXECUTE FUNCTION public.fanout_approved_global_product();
