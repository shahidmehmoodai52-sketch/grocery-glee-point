-- Small, standalone RPC exposing the current tenant's business_type to the
-- frontend, deliberately kept separate from my_store_settings() (which
-- returns SETOF store_settings and is used on every authenticated page —
-- changing its return shape would be a much riskier touch than adding a
-- new, tiny, single-purpose function).
--
-- Verified on tillix-migration-test: returns the caller's tenant id/name/
-- business_type correctly.
CREATE OR REPLACE FUNCTION public.my_tenant()
RETURNS TABLE(id uuid, name text, business_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.name, t.business_type
  FROM public.tenants t
  WHERE t.id = public.current_tenant_id();
$$;
GRANT EXECUTE ON FUNCTION public.my_tenant() TO authenticated;
