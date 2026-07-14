DROP POLICY IF EXISTS customers_insert_auth ON public.customers;
CREATE POLICY customers_insert_auth ON public.customers
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = current_tenant_id()
  AND (
    has_permission(auth.uid(), 'customers')
    OR has_permission(auth.uid(), 'pos')
    OR has_permission(auth.uid(), 'sales')
  )
);