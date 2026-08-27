-- Redesign staff returns: "staff" means an expense_persons record (the same
-- one POS's own "Staff purchase" flow already links sales to via
-- sales.expense_person_id), not a system login user. This supersedes the
-- staff_user_id / tenant_members.staff_ledger_balance model from
-- 20260827180000_staff_sale_returns.sql, which never had any real data
-- (every staff return attempt up to this point had failed client-side).
-- Applied live via Lovable Cloud MCP on 2026-08-27.

-- 1) Revert the old model.
ALTER TABLE public.sale_returns DROP CONSTRAINT IF EXISTS sale_returns_party_consistency_check;
ALTER TABLE public.sale_returns DROP CONSTRAINT IF EXISTS sale_returns_party_type_check;
ALTER TABLE public.sale_returns DROP COLUMN IF EXISTS staff_user_id;
ALTER TABLE public.tenant_members DROP COLUMN IF EXISTS staff_ledger_balance;
DROP FUNCTION IF EXISTS public.list_tenant_staff();

-- 2) New model: sale_returns.expense_person_id, always tied to the original
-- staff-purchase invoice (sale_id) so the person can never be spoofed from
-- the client — the RPC below re-derives it from sales.expense_person_id.
ALTER TABLE public.sale_returns
  ADD COLUMN IF NOT EXISTS expense_person_id uuid NULL REFERENCES public.expense_persons(id);

ALTER TABLE public.sale_returns
  ADD CONSTRAINT sale_returns_party_type_check
  CHECK (party_type IN ('customer','staff'));

ALTER TABLE public.sale_returns
  ADD CONSTRAINT sale_returns_party_consistency_check
  CHECK (
    (party_type = 'staff' AND expense_person_id IS NOT NULL AND customer_id IS NULL)
    OR
    (party_type = 'customer' AND expense_person_id IS NULL)
  );

CREATE OR REPLACE FUNCTION public.complete_sale_return(payload jsonb)
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
  v_refund NUMERIC := COALESCE((payload->>'refund_amount')::NUMERIC, 0);
  v_total NUMERIC;
  v_sale UUID := NULLIF(payload->>'sale_id','')::UUID;
  v_customer UUID := NULLIF(payload->>'customer_id','')::UUID;
  v_method TEXT := COALESCE(payload->>'refund_method','cash');
  v_party_type TEXT := COALESCE(payload->>'party_type','customer');
  v_expense_person UUID;
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_pid UUID;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_cost NUMERIC;
  v_name TEXT;
  v_ok BOOLEAN;
  v_cash_account_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF v_party_type NOT IN ('customer','staff') THEN RAISE EXCEPTION 'Invalid party_type'; END IF;

  IF v_sale IS NOT NULL THEN
    SELECT true INTO v_ok FROM public.sales WHERE id = v_sale AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Sale does not belong to current tenant'; END IF;
  END IF;

  IF v_party_type = 'staff' THEN
    IF v_sale IS NULL THEN RAISE EXCEPTION 'Staff returns must be linked to the original invoice'; END IF;
    SELECT expense_person_id INTO v_expense_person FROM public.sales WHERE id = v_sale AND tenant_id = v_tenant;
    IF v_expense_person IS NULL THEN RAISE EXCEPTION 'That invoice was not a staff purchase'; END IF;
    v_customer := NULL;
    v_refund := 0;
    v_method := 'staff';
  END IF;

  IF v_tax < 0 OR v_refund < 0 THEN RAISE EXCEPTION 'Tax/refund must be non-negative'; END IF;

  IF v_customer IS NOT NULL THEN
    v_ok := NULL;
    SELECT true INTO v_ok FROM public.customers WHERE id = v_customer AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Customer does not belong to current tenant'; END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    v_price := COALESCE((v_item->>'price')::NUMERIC, 0);
    IF v_price < 0 THEN RAISE EXCEPTION 'Price must be non-negative'; END IF;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    IF v_pid IS NOT NULL THEN
      v_ok := NULL;
      SELECT true INTO v_ok FROM public.products WHERE id = v_pid AND tenant_id = v_tenant;
      IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Product % does not belong to current tenant', v_pid; END IF;
    END IF;
    v_subtotal := v_subtotal + (v_qty * v_price);
  END LOOP;

  v_total := v_subtotal + v_tax;
  IF v_refund > v_total THEN RAISE EXCEPTION 'Refund exceeds return total'; END IF;

  INSERT INTO public.sale_returns (tenant_id, sale_id, customer_id, user_id, subtotal, tax, total, refund_amount, refund_method, note, party_type, expense_person_id)
  VALUES (v_tenant, v_sale, v_customer, v_uid, v_subtotal, v_tax, v_total, v_refund, v_method, payload->>'note', v_party_type, v_expense_person)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    v_price := COALESCE((v_item->>'price')::NUMERIC, 0);
    v_cost := COALESCE((v_item->>'cost')::NUMERIC, 0);
    v_name := COALESCE(v_item->>'name', 'Item');
    IF v_pid IS NOT NULL THEN
      SELECT name, cost_price INTO v_name, v_cost FROM public.products WHERE id = v_pid;
    END IF;
    INSERT INTO public.sale_return_items (tenant_id, return_id, product_id, name, qty, price, cost, line_total)
    VALUES (v_tenant, v_id, v_pid, v_name, v_qty, v_price, v_cost, v_qty * v_price);
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET stock = stock + v_qty, updated_at = now() WHERE id = v_pid;
    END IF;
  END LOOP;

  IF v_party_type = 'staff' THEN
    -- Shrink the linked "staff_purchase" expense row by the returned value —
    -- the same row edit_sale()/void_sale() already delete/recreate, so every
    -- ledger and P&L report that reads `expenses` stays correct with no new
    -- category or sign convention to teach them about. `expenses.amount` has
    -- a >= 0 check, so this floors at 0 rather than going negative.
    UPDATE public.expenses
    SET amount = GREATEST(amount - v_total, 0), updated_at = now()
    WHERE sale_id = v_sale AND person_id = v_expense_person AND tenant_id = v_tenant;

    -- Reverse the matching portion of the original cash-out for this sale so
    -- cash-flow reporting reflects the goods coming back.
    SELECT account_id INTO v_cash_account_id
      FROM public.cash_transactions
      WHERE tenant_id = v_tenant AND reference = 'sale:' || v_sale
      ORDER BY created_at ASC LIMIT 1;

    IF v_cash_account_id IS NOT NULL AND v_total > 0 THEN
      INSERT INTO public.cash_transactions (tenant_id, account_id, direction, amount, occurred_on, category, reference, notes, user_id)
      VALUES (v_tenant, v_cash_account_id, 'in', v_total, CURRENT_DATE, 'staff_purchase_return', 'sale_return:' || v_id,
              'Staff purchase return', v_uid);
    END IF;
  ELSIF v_customer IS NOT NULL AND v_total > v_refund THEN
    UPDATE public.customers SET balance = balance - (v_total - v_refund) WHERE id = v_customer;
  END IF;

  RETURN v_id;
END; $function$;
