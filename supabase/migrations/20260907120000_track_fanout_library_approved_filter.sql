-- Drift reconciliation, not a behavior change: this exact function body is
-- already live on both the migration-test project and production (verified
-- via pg_get_functiondef on 2026-09-07), but the `WHERE library_approved =
-- true` filter was never captured in any tracked migration file. The
-- tracked history only had the original 20260720163733 version, which
-- looped over every tenant unconditionally.
--
-- That untracked filter is exactly what makes the fix in
-- 20260902210000_library_access_and_contributions.sql (library_approved
-- defaulting to true) actually matter for the fan-out path: without this
-- filter here, a newly-approved library item would previously have fanned
-- out to every tenant regardless of library access. Recording the real,
-- currently-live definition here so a from-scratch rebuild from migrations
-- doesn't silently drop this filter and reintroduce that gap.
CREATE OR REPLACE FUNCTION public.fanout_approved_global_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  t RECORD;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    FOR t IN SELECT id FROM public.tenants WHERE library_approved = true LOOP
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
END $function$;
