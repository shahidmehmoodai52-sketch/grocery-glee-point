-- Phase D: Controlled tenant data export.
--
-- Two RPCs, both admin_has_perm('shops.view')-gated -- the same permission
-- that already lets an admin see this tenant's customers/products/sales one
-- screen at a time (TenantDetailDialog, SalesTab, CreditSalesDrilldown).
-- Export does not expose any data an admin with that permission could not
-- already see; it only lets them pull it in bulk for download. No new
-- permission key is invented.
--
-- admin_export_tenant_data returns one page of one category at a time
-- (chunked, not fetchAll): the frontend pages through it and assembles the
-- file client-side, so no huge dataset is ever materialized server-side or
-- held in one round trip. Categories are a strict allowlist of hardcoded
-- SELECTs (no dynamic SQL / table-name interpolation from client input),
-- and every SELECT explicitly lists only business columns -- no passwords,
-- tokens, or credentials exist on these tables, and none of that class of
-- column is selected regardless.
--
-- admin_log_tenant_export is a separate, equally gated RPC that records ONE
-- audit entry per completed export (tenant, admin via auth.uid(), which
-- categories, when) via the existing log_admin_action mechanism, called
-- once by the frontend after all requested pages have been fetched. It is
-- deliberately a server-side RPC rather than a direct client call to
-- log_admin_action, so the audit record still passes through real
-- authorization rather than trusting the browser to self-report.

CREATE OR REPLACE FUNCTION public.admin_export_tenant_data(
  _tenant_id uuid,
  _category text,
  _limit integer DEFAULT 500,
  _offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_name text;
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 500), 1), 1000);
  v_offset integer := GREATEST(COALESCE(_offset, 0), 0);
  v_rows jsonb;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT name INTO v_tenant_name FROM public.tenants WHERE id = _tenant_id;
  IF v_tenant_name IS NULL THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  CASE _category
    WHEN 'customers' THEN
      SELECT jsonb_agg(to_jsonb(x)) INTO v_rows FROM (
        SELECT id, name, phone, email, address, balance, opening_balance, created_at
        FROM public.customers WHERE tenant_id = _tenant_id
        ORDER BY created_at LIMIT v_limit OFFSET v_offset
      ) x;
    WHEN 'suppliers' THEN
      SELECT jsonb_agg(to_jsonb(x)) INTO v_rows FROM (
        SELECT id, name, phone, email, address, balance, opening_balance, created_at
        FROM public.suppliers WHERE tenant_id = _tenant_id
        ORDER BY created_at LIMIT v_limit OFFSET v_offset
      ) x;
    WHEN 'products' THEN
      SELECT jsonb_agg(to_jsonb(x)) INTO v_rows FROM (
        SELECT id, name, sku, barcode, category, unit, cost_price, sell_price,
               stock, tax_rate, is_active, created_at
        FROM public.products WHERE tenant_id = _tenant_id
        ORDER BY created_at LIMIT v_limit OFFSET v_offset
      ) x;
    WHEN 'sales' THEN
      SELECT jsonb_agg(to_jsonb(x)) INTO v_rows FROM (
        SELECT id, invoice_no, customer_id, subtotal, tax, discount, total,
               paid, payment_method, status, created_at
        FROM public.sales WHERE tenant_id = _tenant_id
        ORDER BY created_at LIMIT v_limit OFFSET v_offset
      ) x;
    WHEN 'purchases' THEN
      SELECT jsonb_agg(to_jsonb(x)) INTO v_rows FROM (
        SELECT id, invoice_no, supplier_id, subtotal, tax, total, paid,
               payment_method, status, created_at
        FROM public.purchases WHERE tenant_id = _tenant_id
        ORDER BY created_at LIMIT v_limit OFFSET v_offset
      ) x;
    WHEN 'expenses' THEN
      SELECT jsonb_agg(to_jsonb(x)) INTO v_rows FROM (
        SELECT id, category, amount, description, method, expense_date, created_at
        FROM public.expenses WHERE tenant_id = _tenant_id
        ORDER BY created_at LIMIT v_limit OFFSET v_offset
      ) x;
    ELSE
      RAISE EXCEPTION 'Unsupported export category: %', _category;
  END CASE;

  RETURN jsonb_build_object(
    'tenant_id', _tenant_id,
    'tenant_name', v_tenant_name,
    'category', _category,
    'limit', v_limit,
    'offset', v_offset,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'row_count', jsonb_array_length(COALESCE(v_rows, '[]'::jsonb)),
    'has_more', jsonb_array_length(COALESCE(v_rows, '[]'::jsonb)) = v_limit
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_export_tenant_data(uuid, text, integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_export_tenant_data(uuid, text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_log_tenant_export(_tenant_id uuid, _categories text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _categories IS NULL OR array_length(_categories, 1) IS NULL THEN
    RAISE EXCEPTION 'No categories specified';
  END IF;

  PERFORM public.log_admin_action(
    'TENANT_DATA_EXPORT', _tenant_id, 'tenant', _tenant_id::text, NULL,
    NULL, NULL, jsonb_build_object('categories', to_jsonb(_categories))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_log_tenant_export(uuid, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_log_tenant_export(uuid, text[]) TO authenticated;
