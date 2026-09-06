-- Generates a fresh, unused barcode value for the calling tenant, so a shop
-- can print a scannable label for a product that never had a manufacturer
-- barcode (loose produce, in-house bakery items, repackaged bulk goods,
-- etc.) instead of leaving it unscannable at the POS.
--
-- Uses the GS1 "restricted circulation" prefix range 20-29, which the GS1
-- standard itself reserves for internal/in-store use and explicitly says
-- must never be treated as a globally-unique identifier -- exactly the
-- semantics we want here, since this code only needs to be unique within
-- one shop's own catalog, not across every shop on the platform. Sequential
-- per tenant, mirroring next_product_sku()'s existing (max existing + 1)
-- pattern, with a real EAN-13 check digit so it scans cleanly on standard
-- barcode scanners/symbologies that validate it (most retail scanners
-- decode Code128 regardless, but a valid check digit costs nothing extra).
CREATE OR REPLACE FUNCTION public.next_internal_barcode()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tenant_id uuid := public.current_tenant_id();
  _next bigint;
  _body text;
  _sum int := 0;
  _i int;
  _check int;
BEGIN
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'No active tenant';
  END IF;

  SELECT COALESCE(MAX(substring(b.barcode from 2 for 11)::bigint), 0) + 1
    INTO _next
    FROM (
      SELECT barcode FROM public.products
        WHERE tenant_id = _tenant_id AND barcode ~ '^2[0-9]{12}$'
      UNION ALL
      SELECT pb.barcode FROM public.product_barcodes pb
        JOIN public.products p ON p.id = pb.product_id
        WHERE p.tenant_id = _tenant_id AND pb.barcode ~ '^2[0-9]{12}$'
    ) b;

  _body := '2' || lpad(_next::text, 11, '0'); -- 12 data digits

  -- EAN-13 check digit: 1-indexed odd positions weight 1, even positions weight 3.
  FOR _i IN 1..12 LOOP
    _sum := _sum + substring(_body from _i for 1)::int * (CASE WHEN _i % 2 = 1 THEN 1 ELSE 3 END);
  END LOOP;
  _check := (10 - (_sum % 10)) % 10;

  RETURN _body || _check::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.next_internal_barcode() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_internal_barcode() FROM anon;
GRANT EXECUTE ON FUNCTION public.next_internal_barcode() TO authenticated;

-- Every tenant's sequence independently starts at 1, so two unrelated shops
-- will legitimately generate the SAME code (e.g. 2000000000018) for two
-- completely different products. Two separate AFTER INSERT triggers on
-- products already auto-contribute a new barcoded product into the shared,
-- cross-tenant global_products library (confirmed live -- both exist on
-- production and the migration-test project, though only one of the two,
-- contribute_new_product_to_library() from a later, untracked change, is
-- the one actually wired into today's Library feature; the older
-- auto_contribute_global_product() from 20260708175854 is dead code left
-- running alongside it). Left unpatched, either would push the first shop's
-- name/price into the shared library under that barcode, and ON CONFLICT
-- (barcode) DO NOTHING would then silently swallow every other shop's
-- attempt to contribute their own (unrelated) product under the same code
-- -- polluting the shared library with meaningless, shop-local numbers.
-- GS1's own restricted-circulation range is precisely "not globally unique
-- by design", so codes in it must never be auto-contributed to a
-- cross-tenant table keyed by barcode. Patching both triggers rather than
-- just the live one, since the dead one still fires and still writes.
CREATE OR REPLACE FUNCTION public.auto_contribute_global_product()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bc text := NULLIF(trim(NEW.barcode), '');
BEGIN
  IF v_bc IS NOT NULL AND v_bc !~ '^2[0-9]{12}$' THEN
    INSERT INTO public.global_products (name, barcode, category, unit, status, contributed_by_tenant, contributed_by_user)
    VALUES (NEW.name, v_bc, NEW.category, COALESCE(NEW.unit, 'pcs'), 'pending', NEW.tenant_id, auth.uid())
    ON CONFLICT (barcode) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.contribute_new_product_to_library()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  -- Only barcoded products are contributed — barcode is how the library
  -- de-duplicates and matches items. Skip if this barcode is already known
  -- to the library (any status), to avoid duplicate/repeat submissions and
  -- to avoid re-submitting items that were themselves just imported FROM
  -- the library (their barcode already exists there). Also skip GS1
  -- restricted-circulation codes (see comment above this function).
  IF NEW.barcode IS NOT NULL AND NEW.barcode !~ '^2[0-9]{12}$' AND NOT EXISTS (
    SELECT 1 FROM public.global_products g WHERE g.barcode = NEW.barcode
  ) THEN
    INSERT INTO public.global_products
      (name, barcode, item_code, category, unit,
       default_sell_price, default_cost_price,
       status, contributed_by_tenant)
    VALUES
      (NEW.name, NEW.barcode, NEW.sku, NEW.category, COALESCE(NEW.unit, 'pcs'),
       NEW.sell_price, NEW.cost_price,
       'pending', NEW.tenant_id)
    ON CONFLICT (barcode) DO NOTHING;
  END IF;
  RETURN NEW;
END $function$;
