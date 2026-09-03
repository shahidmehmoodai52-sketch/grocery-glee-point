-- Auto-generate the next sequential SKU for a shop's products.
--
-- Existing sku data is already free-form per tenant (manually typed, or
-- carried over from bulk imports) — never globally unique, never guaranteed
-- numeric. So "next sku" is defined as (highest existing NUMERIC sku for
-- this tenant) + 1, ignoring non-numeric skus entirely, rather than a raw
-- product count: a shop that bulk-imported products with skus like "4253"
-- must continue from 4254, not jump to an unrelated "count + 1" value that
-- has nothing to do with its actual numbering.
--
-- A partial UNIQUE(tenant_id, sku) index is the real safety net against
-- two concurrent "Add product" submissions computing the same next number
-- (this function alone, called from two simultaneous requests, could
-- return the same value to both — the database constraint is what actually
-- prevents the resulting duplicate row from being saved). Verified against
-- live data first: zero existing (tenant_id, sku) duplicates, so this is
-- safe to add without breaking any current shop's data.
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_sku_unique
  ON public.products (tenant_id, sku)
  WHERE sku IS NOT NULL;

CREATE OR REPLACE FUNCTION public.next_product_sku()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tenant_id uuid := public.current_tenant_id();
  _next bigint;
BEGIN
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'No active tenant';
  END IF;

  SELECT COALESCE(MAX(sku::bigint), 0) + 1
    INTO _next
    FROM public.products
    WHERE tenant_id = _tenant_id
      AND sku ~ '^[0-9]+$';

  RETURN _next::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.next_product_sku() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_product_sku() FROM anon;
GRANT EXECUTE ON FUNCTION public.next_product_sku() TO authenticated;
