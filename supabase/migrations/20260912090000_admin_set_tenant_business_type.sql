-- Admin panel had no way to change a shop's business_type after signup --
-- it was set once at registration (register_shop) and then only ever
-- displayed read-only (admin_list_tenants' Type column, Library tab's
-- badge). Adds the missing mutation, following the exact same shape as
-- the other single-field tenant admin mutations (admin_set_tenant_status/
-- admin_set_tenant_expiry): gated on the existing 'shops.manage'
-- permission (already described as "Change shop plan & feature overrides"
-- -- extending its scope to this one extra field, not introducing a new
-- permission key), and audit-logged the same way.
--
-- Deliberately just flips the column -- it does not retroactively touch
-- existing products/purchases/pharmacy_product_details rows. That is the
-- same additive-only contract the rest of the pharmacy work this session
-- relies on: nothing reads business_type as a foreign key, it only steers
-- UI branching (useBusinessType()) and the global_products fan-out filter,
-- both of which are safe to have "catch up" the next time each screen is
-- used rather than needing a backfill.
--
-- Verified on tillix-migration-test: forbidden for a plain tenant owner,
-- forbidden for a non-super-admin admin_staff row without 'shops.manage',
-- succeeds for a temporarily-granted admin_staff row and for super_admin;
-- rejects an invalid business_type value; writes exactly one audit_logs
-- row with old/new values. Test tenant reverted to its original
-- business_type afterward.

CREATE OR REPLACE FUNCTION public.admin_set_tenant_business_type(_tenant_id uuid, _business_type text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old text;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.manage') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  -- Kept in sync with tenants_business_type_check (see
  -- 20260911100000_pharmacy_business_type_tenants.sql) -- a future business
  -- type needs both updated together.
  IF _business_type NOT IN ('grocery', 'pharmacy') THEN
    RAISE EXCEPTION 'Invalid business type: %', _business_type;
  END IF;

  SELECT business_type INTO v_old FROM public.tenants WHERE id = _tenant_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Shop not found'; END IF;

  IF v_old IS DISTINCT FROM _business_type THEN
    UPDATE public.tenants SET business_type = _business_type, updated_at = now() WHERE id = _tenant_id;
    INSERT INTO public.audit_logs(tenant_id, user_id, action, table_name, record_id, old_data, new_data)
    VALUES (_tenant_id, auth.uid(), 'UPDATE', 'tenants', _tenant_id,
      jsonb_build_object('business_type', v_old),
      jsonb_build_object('business_type', _business_type, 'admin_action', 'tenant.business_type'));
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_tenant_business_type(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_business_type(uuid, text) TO authenticated;
