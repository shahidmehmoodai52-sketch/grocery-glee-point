
DROP POLICY IF EXISTS customers_update_auth ON public.customers;
DROP POLICY IF EXISTS suppliers_update_auth ON public.suppliers;

CREATE POLICY customers_update_admin ON public.customers
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY suppliers_update_admin ON public.suppliers
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
