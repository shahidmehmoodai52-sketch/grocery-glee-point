-- 1) Missing indexes on foreign-key columns (non-destructive)
CREATE INDEX IF NOT EXISTS idx_admin_staff_added_by ON public.admin_staff(added_by);
CREATE INDEX IF NOT EXISTS idx_admin_staff_perm_granted_by ON public.admin_staff_permissions(granted_by);
CREATE INDEX IF NOT EXISTS idx_app_errors_resolved_by ON public.application_errors(resolved_by);
CREATE INDEX IF NOT EXISTS idx_assets_category ON public.assets(category_id);
CREATE INDEX IF NOT EXISTS idx_cde_approved_by ON public.cash_drawer_events(approved_by);
CREATE INDEX IF NOT EXISTS idx_cde_user ON public.cash_drawer_events(user_id);
CREATE INDEX IF NOT EXISTS idx_gp_contrib_tenant ON public.global_products(contributed_by_tenant);
CREATE INDEX IF NOT EXISTS idx_gp_contrib_user ON public.global_products(contributed_by_user);
CREATE INDEX IF NOT EXISTS idx_gp_reviewed_by ON public.global_products(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_held_bills_cashier ON public.held_bills(cashier_id);
CREATE INDEX IF NOT EXISTS idx_held_bills_customer ON public.held_bills(customer_id);
CREATE INDEX IF NOT EXISTS idx_held_bills_resumed_by ON public.held_bills(resumed_by);
CREATE INDEX IF NOT EXISTS idx_held_bills_shift ON public.held_bills(shift_id);
CREATE INDEX IF NOT EXISTS idx_damages_batch ON public.inventory_damages(batch_id);
CREATE INDEX IF NOT EXISTS idx_damages_product ON public.inventory_damages(product_id);
CREATE INDEX IF NOT EXISTS idx_damages_user ON public.inventory_damages(user_id);
CREATE INDEX IF NOT EXISTS idx_waste_batch ON public.inventory_waste(batch_id);
CREATE INDEX IF NOT EXISTS idx_waste_product ON public.inventory_waste(product_id);
CREATE INDEX IF NOT EXISTS idx_waste_user ON public.inventory_waste(user_id);
CREATE INDEX IF NOT EXISTS idx_handovers_from_shift ON public.manager_handovers(from_shift_id);
CREATE INDEX IF NOT EXISTS idx_handovers_to_shift ON public.manager_handovers(to_shift_id);
CREATE INDEX IF NOT EXISTS idx_handovers_from_user ON public.manager_handovers(from_user);
CREATE INDEX IF NOT EXISTS idx_handovers_to_user ON public.manager_handovers(to_user);
CREATE INDEX IF NOT EXISTS idx_handovers_tenant ON public.manager_handovers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_party_payments_cash_tx ON public.party_payments(cash_transaction_id);
CREATE INDEX IF NOT EXISTS idx_batches_product ON public.product_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_batches_purchase ON public.product_batches(purchase_id);
CREATE INDEX IF NOT EXISTS idx_batches_supplier ON public.product_batches(supplier_id);
CREATE INDEX IF NOT EXISTS idx_reprints_shift ON public.receipt_reprints(shift_id);
CREATE INDEX IF NOT EXISTS idx_reprints_tenant ON public.receipt_reprints(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reprints_user ON public.receipt_reprints(user_id);
CREATE INDEX IF NOT EXISTS idx_sale_voids_approved_by ON public.sale_voids(approved_by);
CREATE INDEX IF NOT EXISTS idx_sale_voids_shift ON public.sale_voids(shift_id);
CREATE INDEX IF NOT EXISTS idx_sale_voids_tenant ON public.sale_voids(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sale_voids_voided_by ON public.sale_voids(voided_by);
CREATE INDEX IF NOT EXISTS idx_checklist_completed_by ON public.shift_checklist(completed_by);
CREATE INDEX IF NOT EXISTS idx_checklist_tenant ON public.shift_checklist(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shift_notes_tenant ON public.shift_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shift_notes_user ON public.shift_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_shift_tasks_assigned_to ON public.shift_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_shift_tasks_completed_by ON public.shift_tasks(completed_by);
CREATE INDEX IF NOT EXISTS idx_shift_tasks_created_by ON public.shift_tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_shift_tasks_shift ON public.shift_tasks(shift_id);
CREATE INDEX IF NOT EXISTS idx_sci_product ON public.stock_count_items(product_id);
CREATE INDEX IF NOT EXISTS idx_products_preferred_supplier_col ON public.products(preferred_supplier_id);

-- 2) Audit log retention (keeps 180 days)
CREATE OR REPLACE FUNCTION public.prune_audit_logs(_days integer DEFAULT 180)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n integer;
BEGIN
  DELETE FROM public.audit_logs WHERE created_at < now() - make_interval(days => _days);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_audit_logs(integer) FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-audit-logs') THEN
    PERFORM cron.unschedule('prune-audit-logs');
  END IF;
  PERFORM cron.schedule('prune-audit-logs', '15 3 * * *', 'SELECT public.prune_audit_logs(180);');
END $$;

-- 3) RLS performance: consolidate duplicate permissive policies and make the
-- tenant lookup a single per-statement evaluation instead of per-row.
-- Effective permissions are unchanged (previous duplicate policies were OR-ed,
-- and the broadest was always the tenant-scoped one).
DROP POLICY IF EXISTS tenant_isolation_select ON public.products;
DROP POLICY IF EXISTS tenant_isolation_insert ON public.products;
DROP POLICY IF EXISTS tenant_isolation_update ON public.products;
DROP POLICY IF EXISTS tenant_isolation_delete ON public.products;
DROP POLICY IF EXISTS products_select_auth ON public.products;
DROP POLICY IF EXISTS products_insert_admin ON public.products;
DROP POLICY IF EXISTS products_update_admin ON public.products;
DROP POLICY IF EXISTS products_delete_admin ON public.products;
CREATE POLICY products_tenant_select ON public.products FOR SELECT TO authenticated USING (tenant_id = (SELECT current_tenant_id()));
CREATE POLICY products_tenant_insert ON public.products FOR INSERT TO authenticated WITH CHECK (tenant_id = (SELECT current_tenant_id()));
CREATE POLICY products_tenant_update ON public.products FOR UPDATE TO authenticated USING (tenant_id = (SELECT current_tenant_id())) WITH CHECK (tenant_id = (SELECT current_tenant_id()));
CREATE POLICY products_tenant_delete ON public.products FOR DELETE TO authenticated USING (tenant_id = (SELECT current_tenant_id()));

DROP POLICY IF EXISTS tenant_isolation_select ON public.product_barcodes;
DROP POLICY IF EXISTS tenant_isolation_insert ON public.product_barcodes;
DROP POLICY IF EXISTS tenant_isolation_update ON public.product_barcodes;
DROP POLICY IF EXISTS tenant_isolation_delete ON public.product_barcodes;
DROP POLICY IF EXISTS product_barcodes_select_auth ON public.product_barcodes;
DROP POLICY IF EXISTS barcodes_admin_insert ON public.product_barcodes;
DROP POLICY IF EXISTS barcodes_admin_update ON public.product_barcodes;
DROP POLICY IF EXISTS barcodes_admin_delete ON public.product_barcodes;
CREATE POLICY barcodes_tenant_select ON public.product_barcodes FOR SELECT TO authenticated USING (tenant_id = (SELECT current_tenant_id()));
CREATE POLICY barcodes_tenant_insert ON public.product_barcodes FOR INSERT TO authenticated WITH CHECK (tenant_id = (SELECT current_tenant_id()));
CREATE POLICY barcodes_tenant_update ON public.product_barcodes FOR UPDATE TO authenticated USING (tenant_id = (SELECT current_tenant_id())) WITH CHECK (tenant_id = (SELECT current_tenant_id()));
CREATE POLICY barcodes_tenant_delete ON public.product_barcodes FOR DELETE TO authenticated USING (tenant_id = (SELECT current_tenant_id()));

DROP POLICY IF EXISTS tenant_isolation_select ON public.sales;
DROP POLICY IF EXISTS tenant_isolation_insert ON public.sales;
DROP POLICY IF EXISTS tenant_isolation_update ON public.sales;
DROP POLICY IF EXISTS tenant_isolation_delete ON public.sales;
DROP POLICY IF EXISTS sales_select_auth ON public.sales;
DROP POLICY IF EXISTS sales_update_admin ON public.sales;
DROP POLICY IF EXISTS sales_delete_admin ON public.sales;
CREATE POLICY sales_tenant_select ON public.sales FOR SELECT TO authenticated USING (tenant_id = (SELECT current_tenant_id()));
CREATE POLICY sales_tenant_insert ON public.sales FOR INSERT TO authenticated WITH CHECK (tenant_id = (SELECT current_tenant_id()));
CREATE POLICY sales_tenant_update ON public.sales FOR UPDATE TO authenticated USING (tenant_id = (SELECT current_tenant_id())) WITH CHECK (tenant_id = (SELECT current_tenant_id()));
CREATE POLICY sales_tenant_delete ON public.sales FOR DELETE TO authenticated USING (tenant_id = (SELECT current_tenant_id()));

DROP POLICY IF EXISTS tenant_isolation_select ON public.sale_items;
DROP POLICY IF EXISTS tenant_isolation_insert ON public.sale_items;
DROP POLICY IF EXISTS tenant_isolation_update ON public.sale_items;
DROP POLICY IF EXISTS tenant_isolation_delete ON public.sale_items;
DROP POLICY IF EXISTS sale_items_select_auth ON public.sale_items;
CREATE POLICY sale_items_tenant_select ON public.sale_items FOR SELECT TO authenticated USING (tenant_id = (SELECT current_tenant_id()));
CREATE POLICY sale_items_tenant_insert ON public.sale_items FOR INSERT TO authenticated WITH CHECK (tenant_id = (SELECT current_tenant_id()));
CREATE POLICY sale_items_tenant_update ON public.sale_items FOR UPDATE TO authenticated USING (tenant_id = (SELECT current_tenant_id())) WITH CHECK (tenant_id = (SELECT current_tenant_id()));
CREATE POLICY sale_items_tenant_delete ON public.sale_items FOR DELETE TO authenticated USING (tenant_id = (SELECT current_tenant_id()));

ANALYZE public.products;
ANALYZE public.product_barcodes;
ANALYZE public.audit_logs;