
-- Fix: user_roles read-all overlap
DROP POLICY IF EXISTS "user_roles_read_all_auth" ON public.user_roles;

-- Fix: restrict customers/suppliers/expense_persons/expenses inserts to admin or permission holders
DROP POLICY IF EXISTS customers_insert_auth ON public.customers;
CREATE POLICY customers_insert_auth ON public.customers FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'customers'));

DROP POLICY IF EXISTS suppliers_insert_auth ON public.suppliers;
CREATE POLICY suppliers_insert_auth ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'suppliers'));

DROP POLICY IF EXISTS ep_insert ON public.expense_persons;
CREATE POLICY ep_insert ON public.expense_persons FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'expenses'));

DROP POLICY IF EXISTS ex_insert ON public.expenses;
CREATE POLICY ex_insert ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'expenses'));

-- Fix: import_batches - restrict to admin + owner
DROP POLICY IF EXISTS "Authenticated can insert import batches" ON public.import_batches;
DROP POLICY IF EXISTS "Authenticated can update import batches" ON public.import_batches;
DROP POLICY IF EXISTS "Authenticated can delete import batches" ON public.import_batches;
DROP POLICY IF EXISTS "Authenticated can view import batches" ON public.import_batches;

CREATE POLICY ib_select ON public.import_batches FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR user_id = auth.uid());
CREATE POLICY ib_insert ON public.import_batches FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'import') AND user_id = auth.uid());
CREATE POLICY ib_update ON public.import_batches FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY ib_delete ON public.import_batches FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
