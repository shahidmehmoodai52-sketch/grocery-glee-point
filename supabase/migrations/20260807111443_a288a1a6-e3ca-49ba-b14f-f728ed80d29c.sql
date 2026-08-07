CREATE OR REPLACE FUNCTION public.enforce_product_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Product limits removed: every plan (including free trial) may add/import
  -- unlimited products, manually or via file/global-library import.
  RETURN NEW;
END
$$;