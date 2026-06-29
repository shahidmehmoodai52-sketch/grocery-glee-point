
DROP POLICY IF EXISTS customers_insert_auth ON public.customers;
CREATE POLICY customers_insert_auth ON public.customers FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS suppliers_insert_auth ON public.suppliers;
CREATE POLICY suppliers_insert_auth ON public.suppliers FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
