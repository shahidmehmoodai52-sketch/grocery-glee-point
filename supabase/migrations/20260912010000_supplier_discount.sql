-- Lets a supplier-given discount be recorded the same way a customer
-- discount already is (record_payment(..., p_method => 'discount')): no
-- cash moves, it settles the ledger like a payment, but unlike a customer
-- discount (a cost, subtracted from profit) a supplier discount is money
-- the shop effectively saved, so it's ADDED to profit — the same treatment
-- purchases.incentive_amount already gets.
--
-- record_payment/update_party_payment/delete_party_payment already handle
-- party_type='supplier' with method='discount' correctly (no cash_transaction,
-- balance adjusted the same as any payment) — nothing to change there. Two
-- read paths need to recognize the new method:

-- 1. Split the supplier ledger's payment branch so a discount shows as its
--    own 'discount' entry type instead of a generic 'payment', mirroring
--    how the customer ledger already distinguishes them by method.
CREATE OR REPLACE FUNCTION public.get_supplier_ledger(p_supplier_id uuid)
 RETURNS TABLE(id uuid, occurred_at timestamp with time zone, entry_type text, reference text, note text, debit numeric, credit numeric, source_data jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 DECLARE
   v_tenant_id uuid := public.current_tenant_id();
 BEGIN
   IF v_tenant_id IS NULL OR NOT EXISTS (
     SELECT 1 FROM public.suppliers s
     WHERE s.id = p_supplier_id AND s.tenant_id = v_tenant_id
   ) THEN
     SELECT s.tenant_id INTO v_tenant_id
     FROM public.suppliers s
     WHERE s.id = p_supplier_id
       AND EXISTS (
         SELECT 1 FROM public.tenant_members tm
         WHERE tm.tenant_id = s.tenant_id AND tm.user_id = auth.uid()
       )
     LIMIT 1;
   END IF;

   IF v_tenant_id IS NULL THEN
     RETURN;
   END IF;

   IF NOT EXISTS (
     SELECT 1 FROM public.suppliers s
     WHERE s.id = p_supplier_id AND s.tenant_id = v_tenant_id
   ) THEN
     RETURN;
   END IF;

   RETURN QUERY
   SELECT * FROM (
     SELECT p.id, p.created_at as occurred_at, 'purchase'::text as entry_type, p.invoice_no as reference, COALESCE(p.note, '') as note, p.total as debit, 0::numeric as credit, to_jsonb(p) as source_data
     FROM public.purchases p
     WHERE p.supplier_id = p_supplier_id AND p.tenant_id = v_tenant_id
     UNION ALL
     SELECT NULL::uuid, p.created_at as occurred_at, 'invoice_payment'::text as entry_type, p.invoice_no || ' · on-invoice' as reference, 'Paid at purchase'::text as note, 0::numeric as debit, p.paid as credit, jsonb_build_object('purchase_id', p.id, 'paid', p.paid) as source_data
     FROM public.purchases p
     WHERE p.supplier_id = p_supplier_id AND p.paid > 0 AND p.tenant_id = v_tenant_id
     UNION ALL
     SELECT NULL::uuid, p.created_at as occurred_at, 'incentive'::text as entry_type, p.invoice_no || ' · incentive' as reference, 'Supplier incentive'::text as note, 0::numeric as debit, p.incentive_amount as credit, jsonb_build_object('purchase_id', p.id, 'incentive_amount', p.incentive_amount) as source_data
     FROM public.purchases p
     WHERE p.supplier_id = p_supplier_id AND p.incentive_amount > 0 AND p.tenant_id = v_tenant_id
     UNION ALL
     SELECT pp.id, pp.created_at as occurred_at, 'payment'::text as entry_type, COALESCE(pp.method, 'Payment') as reference, COALESCE(pp.note, '') as note, 0::numeric as debit, pp.amount as credit, to_jsonb(pp) as source_data
     FROM public.party_payments pp
     WHERE pp.party_id = p_supplier_id AND pp.party_type = 'supplier' AND pp.tenant_id = v_tenant_id AND COALESCE(pp.method, '') <> 'discount'
     UNION ALL
     SELECT pp.id, pp.created_at as occurred_at, 'discount'::text as entry_type, 'Discount'::text as reference, COALESCE(pp.note, '') as note, 0::numeric as debit, pp.amount as credit, to_jsonb(pp) as source_data
     FROM public.party_payments pp
     WHERE pp.party_id = p_supplier_id AND pp.party_type = 'supplier' AND pp.tenant_id = v_tenant_id AND pp.method = 'discount'
     UNION ALL
     SELECT pr.id, pr.created_at as occurred_at, 'return'::text as entry_type, COALESCE(pr.return_no, 'Return') as reference, COALESCE(pr.note, '') as note, 0::numeric as debit, pr.total as credit, to_jsonb(pr) as source_data
     FROM public.purchase_returns pr
     WHERE pr.supplier_id = p_supplier_id AND pr.tenant_id = v_tenant_id
   ) sub
   ORDER BY occurred_at;
 END;
$function$;

-- 2. get_reports_summary (shared by Reports and the Dashboard profit tile):
--    exclude supplier discounts from the "payments to suppliers" cash-out
--    total (no cash actually moved), and surface them as their own total so
--    the frontend can add them to net profit — mirroring incentive_total.
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
  v_returns_cost numeric;
  v_returns_count int;
  v_purchases_total numeric;
  v_incentive_total numeric;
  v_expenses_total numeric;
  v_party_payments_in numeric;
  v_party_payments_out numeric;
  v_credit_sales_total numeric;
  v_cash_sales_total numeric;
  v_discount_total numeric;
  v_supplier_discount_total numeric;
BEGIN
  IF v_tenant_id IS NULL THEN RETURN NULL; END IF;

  v_tz := public.tenant_timezone(v_tenant_id);

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

  SELECT COALESCE(sum(sri.qty * sri.cost), 0)
  INTO v_returns_cost
  FROM sale_return_items sri
  JOIN sale_returns sr ON sr.id = sri.return_id
  WHERE sr.tenant_id = v_tenant_id AND sr.created_at >= p_from_date AND sr.created_at <= p_to_date;

  SELECT COALESCE(sum(total), 0), COALESCE(sum(incentive_amount), 0)
  INTO v_purchases_total, v_incentive_total
  FROM purchases
  WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date;

  SELECT COALESCE(sum(amount), 0) INTO v_expenses_total
  FROM expenses
  WHERE tenant_id = v_tenant_id
    AND expense_date >= (p_from_date AT TIME ZONE v_tz)::date
    AND expense_date <= (p_to_date   AT TIME ZONE v_tz)::date;

  SELECT
    COALESCE(sum(CASE WHEN party_type = 'customer' AND method <> 'discount' THEN amount ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN party_type = 'supplier' AND method <> 'discount' THEN amount ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN party_type = 'customer' AND method = 'discount' THEN amount ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN party_type = 'supplier' AND method = 'discount' THEN amount ELSE 0 END), 0)
  INTO v_party_payments_in, v_party_payments_out, v_discount_total, v_supplier_discount_total
  FROM party_payments
  WHERE tenant_id = v_tenant_id AND created_at >= p_from_date AND created_at <= p_to_date;

  RETURN jsonb_build_object(
    'sales_total', v_sales_total,
    'sales_cost', v_sales_cost,
    'sales_tax', v_sales_tax,
    'sales_count', v_sales_count,
    'returns_total', v_returns_total,
    'returns_cost', v_returns_cost,
    'returns_count', v_returns_count,
    'purchases_total', v_purchases_total,
    'incentive_total', v_incentive_total,
    'expenses_total', v_expenses_total,
    'party_payments_in', v_party_payments_in,
    'party_payments_out', v_party_payments_out,
    'credit_sales_total', v_credit_sales_total,
    'cash_sales_total', v_cash_sales_total,
    'discount_total', v_discount_total,
    'supplier_discount_total', v_supplier_discount_total,
    'timezone', v_tz
  );
END $function$;
