
-- ==========================================================
-- Sprint 5B — strict tenant-scoped RLS
-- Pattern: drop legacy permissive policies, recreate with
--   (tenant_id = current_tenant_id()) AND <existing role/perm>
-- Keep tenant_isolation_* policies as defence-in-depth.
-- ==========================================================

-- ---------- customers ----------
DROP POLICY IF EXISTS customers_select_auth   ON public.customers;
DROP POLICY IF EXISTS customers_insert_auth   ON public.customers;
DROP POLICY IF EXISTS customers_update_admin  ON public.customers;
DROP POLICY IF EXISTS customers_delete_admin  ON public.customers;

CREATE POLICY customers_insert_auth ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_permission(auth.uid(), 'customers'));

CREATE POLICY customers_update_admin ON public.customers
  FOR UPDATE TO authenticated
  USING      (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY customers_delete_admin ON public.customers
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- suppliers ----------
DROP POLICY IF EXISTS suppliers_select_auth   ON public.suppliers;
DROP POLICY IF EXISTS suppliers_insert_auth   ON public.suppliers;
DROP POLICY IF EXISTS suppliers_update_admin  ON public.suppliers;
DROP POLICY IF EXISTS suppliers_delete_admin  ON public.suppliers;

CREATE POLICY suppliers_insert_auth ON public.suppliers
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_permission(auth.uid(), 'suppliers'));

CREATE POLICY suppliers_update_admin ON public.suppliers
  FOR UPDATE TO authenticated
  USING      (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY suppliers_delete_admin ON public.suppliers
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- products ----------
DROP POLICY IF EXISTS products_select_auth   ON public.products;
DROP POLICY IF EXISTS products_insert_admin  ON public.products;
DROP POLICY IF EXISTS products_update_admin  ON public.products;
DROP POLICY IF EXISTS products_delete_admin  ON public.products;

CREATE POLICY products_insert_admin ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY products_update_admin ON public.products
  FOR UPDATE TO authenticated
  USING      (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY products_delete_admin ON public.products
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- product_barcodes ----------
DROP POLICY IF EXISTS barcodes_select_auth  ON public.product_barcodes;
DROP POLICY IF EXISTS barcodes_admin_insert ON public.product_barcodes;
DROP POLICY IF EXISTS barcodes_admin_update ON public.product_barcodes;
DROP POLICY IF EXISTS barcodes_admin_delete ON public.product_barcodes;

CREATE POLICY barcodes_admin_insert ON public.product_barcodes
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY barcodes_admin_update ON public.product_barcodes
  FOR UPDATE TO authenticated
  USING      (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY barcodes_admin_delete ON public.product_barcodes
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- expense_persons ----------
DROP POLICY IF EXISTS ep_select        ON public.expense_persons;
DROP POLICY IF EXISTS ep_insert        ON public.expense_persons;
DROP POLICY IF EXISTS ep_update_admin  ON public.expense_persons;
DROP POLICY IF EXISTS ep_delete_admin  ON public.expense_persons;

CREATE POLICY ep_insert ON public.expense_persons
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_permission(auth.uid(), 'expenses'));

CREATE POLICY ep_update_admin ON public.expense_persons
  FOR UPDATE TO authenticated
  USING      (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY ep_delete_admin ON public.expense_persons
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- expenses ----------
DROP POLICY IF EXISTS ex_select        ON public.expenses;
DROP POLICY IF EXISTS ex_insert        ON public.expenses;
DROP POLICY IF EXISTS ex_update_admin  ON public.expenses;
DROP POLICY IF EXISTS ex_delete_admin  ON public.expenses;

CREATE POLICY ex_insert ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_permission(auth.uid(), 'expenses'));

CREATE POLICY ex_update_admin ON public.expenses
  FOR UPDATE TO authenticated
  USING      (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY ex_delete_admin ON public.expenses
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- party_payments ----------
DROP POLICY IF EXISTS party_payments_select_auth   ON public.party_payments;
DROP POLICY IF EXISTS party_payments_update_admin  ON public.party_payments;
DROP POLICY IF EXISTS party_payments_delete_admin  ON public.party_payments;
-- INSERT stays as tenant_isolation_insert (writes go through record_payment SECURITY DEFINER)

CREATE POLICY party_payments_update_admin ON public.party_payments
  FOR UPDATE TO authenticated
  USING      (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY party_payments_delete_admin ON public.party_payments
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- purchases ----------
DROP POLICY IF EXISTS purchases_select_auth   ON public.purchases;
DROP POLICY IF EXISTS purchases_update_admin  ON public.purchases;
DROP POLICY IF EXISTS purchases_delete_admin  ON public.purchases;

CREATE POLICY purchases_update_admin ON public.purchases
  FOR UPDATE TO authenticated
  USING      (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY purchases_delete_admin ON public.purchases
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- purchase_items ----------
DROP POLICY IF EXISTS purchase_items_select_auth ON public.purchase_items;
-- writes stay tenant_isolation_* (SECURITY DEFINER RPC)

-- ---------- purchase_returns ----------
DROP POLICY IF EXISTS purchase_returns_select_auth   ON public.purchase_returns;
DROP POLICY IF EXISTS purchase_returns_update_admin  ON public.purchase_returns;
DROP POLICY IF EXISTS purchase_returns_delete_admin  ON public.purchase_returns;

CREATE POLICY purchase_returns_update_admin ON public.purchase_returns
  FOR UPDATE TO authenticated
  USING      (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY purchase_returns_delete_admin ON public.purchase_returns
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- purchase_return_items ----------
DROP POLICY IF EXISTS pri_select_auth ON public.purchase_return_items;

-- ---------- sales ----------
DROP POLICY IF EXISTS sales_select_auth   ON public.sales;
DROP POLICY IF EXISTS sales_update_admin  ON public.sales;
DROP POLICY IF EXISTS sales_delete_admin  ON public.sales;

CREATE POLICY sales_update_admin ON public.sales
  FOR UPDATE TO authenticated
  USING      (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY sales_delete_admin ON public.sales
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- sale_items ----------
DROP POLICY IF EXISTS sale_items_select_auth ON public.sale_items;

-- ---------- sale_returns ----------
DROP POLICY IF EXISTS sale_returns_select_auth   ON public.sale_returns;
DROP POLICY IF EXISTS sale_returns_update_admin  ON public.sale_returns;
DROP POLICY IF EXISTS sale_returns_delete_admin  ON public.sale_returns;

CREATE POLICY sale_returns_update_admin ON public.sale_returns
  FOR UPDATE TO authenticated
  USING      (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY sale_returns_delete_admin ON public.sale_returns
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- sale_return_items ----------
DROP POLICY IF EXISTS sri_select_auth ON public.sale_return_items;

-- ---------- store_settings ----------
DROP POLICY IF EXISTS settings_read_auth    ON public.store_settings;
DROP POLICY IF EXISTS settings_write_admin  ON public.store_settings;

CREATE POLICY settings_insert_admin ON public.store_settings
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY settings_update_admin ON public.store_settings
  FOR UPDATE TO authenticated
  USING      (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY settings_delete_admin ON public.store_settings
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- import_batches ----------
DROP POLICY IF EXISTS ib_select ON public.import_batches;
DROP POLICY IF EXISTS ib_insert ON public.import_batches;
DROP POLICY IF EXISTS ib_update ON public.import_batches;
DROP POLICY IF EXISTS ib_delete ON public.import_batches;

CREATE POLICY ib_select ON public.import_batches
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'admin'::public.app_role)
              OR user_id = auth.uid()));

CREATE POLICY ib_insert ON public.import_batches
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_permission(auth.uid(), 'import')
              AND user_id = auth.uid());

CREATE POLICY ib_update ON public.import_batches
  FOR UPDATE TO authenticated
  USING      (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY ib_delete ON public.import_batches
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- audit_logs (dedupe) ----------
DROP POLICY IF EXISTS tenant_isolation_select ON public.audit_logs;
-- keep audit_logs_select_tenant

-- ---------- application_errors (drop dead NULL branch) ----------
DROP POLICY IF EXISTS tenant_isolation_select ON public.application_errors;
-- keep application_errors_select_tenant which is strict

-- ---------- backup_metadata (drop dead NULL branch) ----------
DROP POLICY IF EXISTS tenant_isolation_select ON public.backup_metadata;
-- keep backup_metadata_select_tenant which is strict
