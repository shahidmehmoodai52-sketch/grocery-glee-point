
-- ─────────────────────────────────────────────────────────────
-- 1) SECURITY DEFINER lockdown
--    Revoke from PUBLIC/anon, grant to authenticated + service_role.
--    Trigger-only functions get REVOKE only (Postgres invokes them
--    internally; no EXECUTE grant is required).
-- ─────────────────────────────────────────────────────────────

-- Callable helpers / RPCs
DO $$
DECLARE
  fn TEXT;
  callable TEXT[] := ARRAY[
    'public.active_plan_for_tenant(uuid)',
    'public.can_add_product(uuid)',
    'public.can_add_user(uuid)',
    'public.complete_purchase(jsonb)',
    'public.complete_purchase_return(jsonb)',
    'public.complete_sale(jsonb)',
    'public.complete_sale_return(jsonb)',
    'public.current_tenant_id()',
    'public.delete_party_payment(uuid)',
    'public.has_active_subscription(uuid)',
    'public.has_feature_access(uuid, text)',
    'public.has_permission(uuid, text)',
    'public.has_permission(uuid, uuid, text)',
    'public.has_role(uuid, public.app_role)',
    'public.has_role(uuid, uuid, public.tenant_role)',
    'public.has_tenant_permission(uuid, uuid, text)',
    'public.is_tenant_member(uuid, uuid)',
    'public.log_application_error(text, text, text, text, jsonb)',
    'public.my_store_settings()',
    'public.record_payment(text, uuid, numeric, text, text)',
    'public.update_party_payment(uuid, numeric, text, text, timestamptz)'
  ];
BEGIN
  FOREACH fn IN ARRAY callable LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- Trigger-only functions: revoke only (never called via API)
DO $$
DECLARE
  fn TEXT;
  trigger_only TEXT[] := ARRAY[
    'public.enforce_product_limit()',
    'public.enforce_tenant_member_guardrails()',
    'public.enforce_user_limit()',
    'public.enforce_user_roles_guardrails()',
    'public.fill_tenant_id()',
    'public.handle_new_user()',
    'public.log_audit()',
    'public.provision_tenant_store_settings()',
    'public.seed_tenant_onboarding()',
    'public.touch_updated_at()'
  ];
BEGIN
  FOREACH fn IN ARRAY trigger_only LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2) Missing FK indexes
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sales_cashier_id                 ON public.sales(cashier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_user_id                ON public.purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_party_payments_user_id           ON public.party_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_user_id             ON public.sale_returns(user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_user_id         ON public.purchase_returns(user_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_user_id           ON public.import_batches(user_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id            ON public.sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id        ON public.purchase_items(product_id);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_product_id     ON public.sale_return_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_product_id ON public.purchase_return_items(product_id);
CREATE INDEX IF NOT EXISTS idx_tenants_owner_id                 ON public.tenants(owner_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_invited_by        ON public.tenant_members(invited_by);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_invited_by    ON public.tenant_invitations(invited_by);
CREATE INDEX IF NOT EXISTS idx_tenant_user_permissions_granted_by ON public.tenant_user_permissions(granted_by);
CREATE INDEX IF NOT EXISTS idx_tenant_user_permissions_user_id  ON public.tenant_user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_plan_id     ON public.tenant_subscriptions(plan_id);

-- ─────────────────────────────────────────────────────────────
-- 3) Performance index: product list hot path
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_tenant_active_name
  ON public.products(tenant_id, is_active, name);
