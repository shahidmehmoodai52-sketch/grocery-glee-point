-- One barcode belongs to exactly one product per shop.
--
-- A product may have many barcodes (products.barcode + product_barcodes),
-- but the same barcode must never point at two different products in the
-- same shop: a POS scan then picks one of them arbitrarily (often a Rs 0
-- duplicate). Until now only product_barcodes had a (tenant_id, barcode)
-- unique index; products.barcode was unchecked, so POS quick-add
-- double-submits, stale-catalogue quick-adds and the Products page (product
-- row inserted before its barcode insert failed) produced 57 duplicated
-- codes across 3 shops. Those were cleaned up on 2026-09-27 (backup in the
-- private `backup` schema, tables dup_barcode_cleanup_20260927_*).
--
-- This trigger enforces the rule for every writer (POS, Products page,
-- bulk import, offline sync queue, RPCs). It raises SQLSTATE 23505 with a
-- "duplicate key ... barcode" message, which the Import page already maps
-- to its friendly "barcode pehle se mojood hai (skip kiya gaya)" text.
-- An advisory lock per (tenant, barcode) closes the race between two
-- concurrent inserts of the same code.

CREATE OR REPLACE FUNCTION public.enforce_unique_product_barcode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code   text;
  v_pid    uuid;
  v_tenant uuid;
  v_other  text;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    IF TG_OP = 'UPDATE' AND NEW.barcode IS NOT DISTINCT FROM OLD.barcode THEN
      RETURN NEW;
    END IF;
    v_pid := NEW.id;
  ELSE
    IF TG_OP = 'UPDATE' AND NEW.barcode IS NOT DISTINCT FROM OLD.barcode
       AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id THEN
      RETURN NEW;
    END IF;
    v_pid := NEW.product_id;
  END IF;

  v_code := NULLIF(btrim(NEW.barcode), '');
  IF v_code IS NULL THEN RETURN NEW; END IF;
  v_tenant := COALESCE(NEW.tenant_id, public.current_tenant_id());
  IF v_tenant IS NULL THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || v_code, 0));

  SELECT p.name INTO v_other
    FROM public.products p
   WHERE p.tenant_id = v_tenant AND p.barcode = v_code AND p.id <> v_pid
   LIMIT 1;
  IF v_other IS NULL THEN
    SELECT p.name INTO v_other
      FROM public.product_barcodes b
      JOIN public.products p ON p.id = b.product_id
     WHERE b.tenant_id = v_tenant AND b.barcode = v_code AND b.product_id <> v_pid
     LIMIT 1;
  END IF;

  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format('duplicate key: barcode %s is already used by product "%s"', v_code, v_other),
      HINT = 'A barcode can belong to only one product. Edit that product instead, or use a different barcode.';
  END IF;
  RETURN NEW;
END
$function$;

-- Named after trg_fill_tenant_id alphabetically, so NEW.tenant_id is already
-- filled in when this runs on INSERT.
DROP TRIGGER IF EXISTS trg_unique_product_barcode ON public.products;
CREATE TRIGGER trg_unique_product_barcode
  BEFORE INSERT OR UPDATE OF barcode ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_product_barcode();

DROP TRIGGER IF EXISTS trg_unique_product_barcode ON public.product_barcodes;
CREATE TRIGGER trg_unique_product_barcode
  BEFORE INSERT OR UPDATE OF barcode, product_id ON public.product_barcodes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_product_barcode();

-- Library imports only checked products.barcode, not a shop's extra
-- barcodes — with the rule above, a library barcode that matches an extra
-- barcode would now abort the whole bulk import. Skip those instead (and
-- reuse the owning product for a single import), same as a primary match.
CREATE OR REPLACE FUNCTION public.bulk_import_from_global_library()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;

  PERFORM set_config('app.library_import', '1', true);

  WITH src AS (
    SELECT DISTINCT ON (COALESCE(g.barcode, g.id::text))
      g.name, g.barcode, g.category, g.unit,
      g.default_sell_price, g.default_cost_price,
      NULLIF(g.item_code, g.barcode) AS candidate_sku
    FROM public.global_products g
    WHERE g.status = 'approved'
      AND g.business_type = (SELECT business_type FROM public.tenants WHERE id = v_tenant)
      AND public.tenant_category_allowed(v_tenant, g.category)
      AND NOT EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.tenant_id = v_tenant
          AND (
            (g.barcode IS NOT NULL AND p.barcode = g.barcode)
            OR (g.item_code IS NOT NULL AND p.sku = g.item_code)
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.product_barcodes b
        WHERE b.tenant_id = v_tenant AND g.barcode IS NOT NULL AND b.barcode = g.barcode
      )
    ORDER BY COALESCE(g.barcode, g.id::text), g.name
  ),
  numbered AS (
    SELECT s.*,
           CASE WHEN s.candidate_sku IS NULL THEN NULL
                ELSE ROW_NUMBER() OVER (PARTITION BY s.candidate_sku ORDER BY s.name)
           END AS rn
    FROM src s
  ),
  inserted AS (
    INSERT INTO public.products
      (tenant_id, name, barcode, sku, category, unit, sell_price, cost_price, stock, is_active)
    SELECT
      v_tenant, n.name, n.barcode,
      CASE
        WHEN n.candidate_sku IS NULL THEN NULL
        WHEN n.rn > 1 THEN NULL
        WHEN EXISTS (
          SELECT 1 FROM public.products p2
          WHERE p2.tenant_id = v_tenant AND p2.sku = n.candidate_sku
        ) THEN NULL
        ELSE n.candidate_sku
      END,
      n.category,
      COALESCE(n.unit, 'pcs'),
      COALESCE(n.default_sell_price, 0),
      COALESCE(n.default_cost_price, 0),
      0,
      true
    FROM numbered n
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;

  RETURN v_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.import_from_global_library(_global_id uuid, _sell_price numeric DEFAULT 0, _cost_price numeric DEFAULT 0, _stock numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  g public.global_products%ROWTYPE;
  v_new_id uuid;
  v_existing uuid;
  v_sell numeric;
  v_cost numeric;
  v_sku text;
  v_sku_taken boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;

  PERFORM set_config('app.library_import', '1', true);

  SELECT * INTO g FROM public.global_products WHERE id = _global_id AND status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Library item not found or not approved'; END IF;

  IF g.barcode IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.products
      WHERE tenant_id = v_tenant AND barcode = g.barcode LIMIT 1;
    IF v_existing IS NULL THEN
      SELECT product_id INTO v_existing FROM public.product_barcodes
        WHERE tenant_id = v_tenant AND barcode = g.barcode LIMIT 1;
    END IF;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  v_sell := CASE WHEN COALESCE(_sell_price, 0) > 0 THEN _sell_price ELSE COALESCE(g.default_sell_price, 0) END;
  v_cost := CASE WHEN COALESCE(_cost_price, 0) > 0 THEN _cost_price ELSE COALESCE(g.default_cost_price, 0) END;
  v_sku := NULLIF(g.item_code, g.barcode);

  IF v_sku IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.products WHERE tenant_id = v_tenant AND sku = v_sku)
      INTO v_sku_taken;
    IF v_sku_taken THEN v_sku := NULL; END IF;
  END IF;

  INSERT INTO public.products
    (tenant_id, name, barcode, sku, category, unit, sell_price, cost_price, stock, is_active)
  VALUES
    (v_tenant, g.name, g.barcode, v_sku, g.category, COALESCE(g.unit, 'pcs'),
     v_sell, v_cost, COALESCE(_stock, 0), true)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END
$function$;
