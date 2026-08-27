-- Supplier target incentives on a purchase: recorded for reporting only,
-- never folded into subtotal/tax/total/paid so the bill and the supplier's
-- balance are completely unaffected. Feeds straight into net profit via
-- get_reports_summary(). Applied live via Lovable Cloud MCP on 2026-08-27.

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS incentive_amount numeric NOT NULL DEFAULT 0
  CHECK (incentive_amount >= 0);

COMMENT ON COLUMN public.purchases.incentive_amount IS
  'Supplier incentive/bonus for hitting a target — recorded on the purchase for reporting only. Never included in subtotal/tax/total/paid, so it never touches the bill or the supplier balance.';

CREATE OR REPLACE FUNCTION public.complete_purchase(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_item JSONB;
  v_subtotal NUMERIC := 0;
  v_tax NUMERIC := COALESCE((payload->>'tax')::NUMERIC, 0);
  v_paid NUMERIC := COALESCE((payload->>'paid')::NUMERIC, 0);
  v_incentive NUMERIC := COALESCE((payload->>'incentive_amount')::NUMERIC, 0);
  v_total NUMERIC;
  v_supplier UUID := NULLIF(payload->>'supplier_id','')::UUID;
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_qty NUMERIC;
  v_cost NUMERIC;
  v_pid UUID;
  v_old_stock NUMERIC;
  v_old_cost NUMERIC;
  v_avail_stock NUMERIC;
  v_new_avg NUMERIC;
  v_ok BOOLEAN;
  v_method TEXT := COALESCE(NULLIF(payload->>'payment_method',''), 'cash');
  v_account UUID := NULLIF(payload->>'account_id','')::UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF v_tax < 0 OR v_paid < 0 THEN RAISE EXCEPTION 'Tax and paid must be non-negative'; END IF;
  IF v_incentive < 0 THEN RAISE EXCEPTION 'Incentive must be non-negative'; END IF;

  IF v_supplier IS NOT NULL THEN
    SELECT true INTO v_ok FROM public.suppliers WHERE id = v_supplier AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Supplier does not belong to current tenant'; END IF;
  END IF;

  IF v_account IS NOT NULL THEN
    v_ok := NULL;
    SELECT true INTO v_ok FROM public.cash_accounts WHERE id = v_account AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Payment account does not belong to current tenant'; END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_cost := (v_item->>'cost')::NUMERIC;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    IF v_cost IS NULL OR v_cost < 0 THEN RAISE EXCEPTION 'Cost must be non-negative'; END IF;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    IF v_pid IS NOT NULL THEN
      v_ok := NULL;
      SELECT true INTO v_ok FROM public.products WHERE id = v_pid AND tenant_id = v_tenant;
      IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Product % does not belong to current tenant', v_pid; END IF;
    END IF;
    v_subtotal := v_subtotal + (v_qty * v_cost);
  END LOOP;
  v_total := v_subtotal + v_tax;

  -- incentive_amount is recorded for reporting only — it is never folded
  -- into subtotal/tax/total/paid, so the bill and supplier balance below
  -- are computed exactly as before and stay unaffected.
  INSERT INTO public.purchases (tenant_id, supplier_id, user_id, subtotal, tax, total, paid, incentive_amount, note, payment_method, account_id)
  VALUES (v_tenant, v_supplier, v_uid, v_subtotal, v_tax, v_total, v_paid, v_incentive, payload->>'note', v_method, v_account)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_cost := (v_item->>'cost')::NUMERIC;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;

    INSERT INTO public.purchase_items (tenant_id, purchase_id, product_id, name, qty, cost, line_total)
    VALUES (v_tenant, v_id, v_pid, v_item->>'name', v_qty, v_cost, v_qty * v_cost);

    IF v_pid IS NOT NULL THEN
      SELECT stock, cost_price INTO v_old_stock, v_old_cost
        FROM public.products WHERE id = v_pid FOR UPDATE;
      v_avail_stock := GREATEST(COALESCE(v_old_stock,0), 0);
      IF v_avail_stock > 0 THEN
        v_new_avg := ((v_avail_stock * COALESCE(v_old_cost,0)) + (v_qty * v_cost))
                     / (v_avail_stock + v_qty);
      ELSE
        v_new_avg := v_cost;
      END IF;
      UPDATE public.products SET
        stock = COALESCE(stock,0) + v_qty,
        cost_price = ROUND(v_new_avg::numeric, 4),
        updated_at = now()
      WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_total > v_paid AND v_supplier IS NOT NULL THEN
    UPDATE public.suppliers SET balance = balance + (v_total - v_paid) WHERE id = v_supplier;
  END IF;

  RETURN v_id;
END; $function$;

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
    COALESCE(sum(CASE WHEN party_type = 'customer' THEN amount ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN party_type = 'supplier' THEN amount ELSE 0 END), 0)
  INTO v_party_payments_in, v_party_payments_out
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
    'timezone', v_tz
  );
END $function$;
