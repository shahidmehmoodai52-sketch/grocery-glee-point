-- Customer discount: waives part of what a customer owes without any cash
-- moving. Reuses record_payment()/update_party_payment()/delete_party_payment()
-- as-is (a discount is a party_payments row with method='discount' and no
-- account_id, so those functions already skip creating a cash_transactions
-- row — nothing to change there). get_reports_summary() now also returns
-- discount_total so Dashboard/Reports can subtract it from net profit.
-- Applied live via Lovable Cloud MCP on 2026-08-28.

CREATE OR REPLACE FUNCTION public.get_reports_summary(p_from_date timestamp with time zone, p_to_date timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_tz text;
  v_sales_total numeric;
  v_sales_cost numeric;
  v_sales_tax numeric;
  v_sales_count int;
  v_returns_total numeric;
  v_returns_count int;
  v_purchases_total numeric;
  v_incentive_total numeric;
  v_expenses_total numeric;
  v_party_payments_in numeric;
  v_party_payments_out numeric;
  v_credit_sales_total numeric;
  v_cash_sales_total numeric;
  v_discount_total numeric;
BEGIN
  IF v_tenant_id IS NULL THEN RETURN NULL; END IF;

  -- Shop's own local zone, not a hard-coded country.
  v_tz := public.tenant_timezone(v_tenant_id);

  -- Timestamp columns keep exact instant filtering (unchanged semantics).
  SELECT
    COALESCE(sum(total), 0),
    COALESCE(sum(cost_total), 0),
    COALESCE(sum(tax), 0),
    count(*)::int,
    COALESCE(sum(CASE WHEN status = 'credit' THEN (total - paid) ELSE 0 END), 0),
    COALESCE(sum(paid), 0)
  INTO v_sales_total, v_sales_cost, v_sales_tax, v_sales_count, v_credit_sales_total, v_cash_sales_total
  FROM sales
  WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date
    AND status <> 'voided';

  SELECT COALESCE(sum(total), 0), count(*)::int
  INTO v_returns_total, v_returns_count
  FROM sale_returns
  WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date;

  SELECT COALESCE(sum(total), 0), COALESCE(sum(incentive_amount), 0)
  INTO v_purchases_total, v_incentive_total
  FROM purchases
  WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date;

  -- expense_date is a plain business date. Map the instant range into the
  -- shop's local calendar so a local day never pulls the neighbouring day.
  SELECT COALESCE(sum(amount), 0) INTO v_expenses_total
  FROM expenses
  WHERE tenant_id = v_tenant_id
    AND expense_date >= (p_from_date AT TIME ZONE v_tz)::date
    AND expense_date <= (p_to_date   AT TIME ZONE v_tz)::date;

  SELECT
    COALESCE(sum(CASE WHEN party_type = 'customer' AND method <> 'discount' THEN amount ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN party_type = 'supplier' THEN amount ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN party_type = 'customer' AND method = 'discount' THEN amount ELSE 0 END), 0)
  INTO v_party_payments_in, v_party_payments_out, v_discount_total
  FROM party_payments
  WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date;

  RETURN jsonb_build_object(
    'sales_total', v_sales_total,
    'sales_cost', v_sales_cost,
    'sales_tax', v_sales_tax,
    'sales_count', v_sales_count,
    'returns_total', v_returns_total,
    'returns_count', v_returns_count,
    'purchases_total', v_purchases_total,
    'incentive_total', v_incentive_total,
    'expenses_total', v_expenses_total,
    'party_payments_in', v_party_payments_in,
    'party_payments_out', v_party_payments_out,
    'credit_sales_total', v_credit_sales_total,
    'cash_sales_total', v_cash_sales_total,
    'discount_total', v_discount_total,
    'timezone', v_tz
  );
END $function$;
