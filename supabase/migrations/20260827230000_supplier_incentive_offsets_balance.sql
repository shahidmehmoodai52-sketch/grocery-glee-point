-- A purchase incentive is money the shop doesn't actually owe the supplier
-- for that bill — every place that computes "how much do we owe this
-- supplier" needs to subtract it, or the supplier ledger/payables shows a
-- false outstanding balance whenever the shop nets the incentive off its
-- payment. The bill itself (subtotal/tax/total) still stays untouched.
-- Applied live via Lovable Cloud MCP on 2026-08-27. As of this date no
-- purchase had incentive_amount > 0 recorded yet, so no backfill of the
-- suppliers.balance cached column was needed.

-- 1) Central helper behind Cash Flow's "payables" figure.
CREATE OR REPLACE FUNCTION public.supplier_balance_calc(p_supplier_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT round(
      COALESCE((SELECT s.opening_balance FROM suppliers s WHERE s.id = p_supplier_id), 0)
    + COALESCE((SELECT sum(p.total) FROM purchases p WHERE p.supplier_id = p_supplier_id), 0)
    - COALESCE((SELECT sum(p.paid)  FROM purchases p WHERE p.supplier_id = p_supplier_id), 0)
    - COALESCE((SELECT sum(p.incentive_amount) FROM purchases p WHERE p.supplier_id = p_supplier_id), 0)
    - COALESCE((SELECT sum(pr.total) FROM purchase_returns pr WHERE pr.supplier_id = p_supplier_id), 0)
    - COALESCE((SELECT sum(pp.amount) FROM party_payments pp
                 WHERE pp.party_id = p_supplier_id
                   AND (pp.party_type IS NULL OR pp.party_type = 'supplier')), 0)
  , 2);
$function$;

-- 2) Suppliers list page's "current_balance" + a new all-time incentive_total.
DROP FUNCTION IF EXISTS public.get_supplier_balances();

CREATE FUNCTION public.get_supplier_balances()
 RETURNS TABLE(id uuid, name text, phone text, email text, address text, opening_balance numeric, current_balance numeric, incentive_total numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.name,
    s.phone,
    s.email,
    s.address,
    s.opening_balance,
    (
      COALESCE(s.opening_balance, 0) +
      COALESCE((SELECT SUM(p.total - p.paid - p.incentive_amount) FROM public.purchases p WHERE p.supplier_id = s.id AND p.tenant_id = v_tenant), 0) -
      COALESCE((SELECT SUM(pp.amount) FROM public.party_payments pp WHERE pp.party_id = s.id AND pp.party_type = 'supplier' AND pp.tenant_id = v_tenant), 0) -
      COALESCE((SELECT SUM(pr.total) FROM public.purchase_returns pr WHERE pr.supplier_id = s.id AND pr.tenant_id = v_tenant), 0)
    ) AS current_balance,
    COALESCE((SELECT SUM(p.incentive_amount) FROM public.purchases p WHERE p.supplier_id = s.id AND p.tenant_id = v_tenant), 0) AS incentive_total
  FROM public.suppliers s
  WHERE s.tenant_id = v_tenant
  ORDER BY s.name;
END;
$function$;

-- 3) Per-supplier ledger: add an "incentive" credit line per purchase, so
-- the running balance nets it out and it's individually visible/auditable.
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
     WHERE pp.party_id = p_supplier_id AND pp.party_type = 'supplier' AND pp.tenant_id = v_tenant_id
     UNION ALL
     SELECT pr.id, pr.created_at as occurred_at, 'return'::text as entry_type, COALESCE(pr.return_no, 'Return') as reference, COALESCE(pr.note, '') as note, 0::numeric as debit, pr.total as credit, to_jsonb(pr) as source_data
     FROM public.purchase_returns pr
     WHERE pr.supplier_id = p_supplier_id AND pr.tenant_id = v_tenant_id
   ) sub
   ORDER BY occurred_at;
 END;
$function$;

-- 4) complete_purchase: incentive now offsets the supplier balance update too.
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
  -- into subtotal/tax/total/paid, so the bill itself is unaffected. It DOES
  -- offset the supplier balance below, since it's money the shop doesn't
  -- actually owe (matches supplier_balance_calc() / get_supplier_balances()).
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

  IF v_supplier IS NOT NULL THEN
    UPDATE public.suppliers SET balance = balance + (v_total - v_paid - v_incentive) WHERE id = v_supplier;
  END IF;

  RETURN v_id;
END; $function$;
