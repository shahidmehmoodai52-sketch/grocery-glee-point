-- Enforce barcode requirement for global library contributions and admin approval gate

-- 1) Update trigger: skip contribution if barcode is missing
CREATE OR REPLACE FUNCTION public.auto_contribute_global_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bc text := NULLIF(trim(NEW.barcode), '');
  v_name text := NULLIF(trim(NEW.name), '');
BEGIN
  -- Barcode is required for library contribution
  IF v_name IS NULL OR v_bc IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.global_products
    (name, barcode, category, unit, status, contributed_by_tenant, contributed_by_user)
  VALUES
    (v_name, v_bc, NEW.category, COALESCE(NEW.unit, 'pcs'), 'pending', NEW.tenant_id, auth.uid())
  ON CONFLICT (barcode) DO NOTHING;

  RETURN NEW;
END $function$;

-- 2) Tighten SELECT policy: contributors do NOT see their pending items in browse;
--    only approved items are visible (to approved shops), plus admins see everything.
DROP POLICY IF EXISTS "read approved or own or admin" ON public.global_products;

CREATE POLICY "read approved for approved shops or admin"
ON public.global_products
FOR SELECT
USING (
  (
    status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = current_tenant_id() AND t.library_approved = true
    )
  )
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);