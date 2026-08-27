-- Staff sale returns: a return can now belong to a "customer" (unchanged) or
-- "staff" (a tenant member). Staff returns never pay out cash — the value is
-- credited to the staff member's own ledger (tenant_members.staff_ledger_balance)
-- instead. Applied live via Lovable Cloud MCP on 2026-08-27; kept here so the
-- migration history matches production.

ALTER TABLE public.sale_returns
  ADD COLUMN IF NOT EXISTS party_type text NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS staff_user_id uuid NULL REFERENCES auth.users(id);

ALTER TABLE public.sale_returns
  DROP CONSTRAINT IF EXISTS sale_returns_party_type_check;
ALTER TABLE public.sale_returns
  ADD CONSTRAINT sale_returns_party_type_check
  CHECK (party_type IN ('customer','staff'));

ALTER TABLE public.sale_returns
  DROP CONSTRAINT IF EXISTS sale_returns_party_consistency_check;
ALTER TABLE public.sale_returns
  ADD CONSTRAINT sale_returns_party_consistency_check
  CHECK (
    (party_type = 'staff' AND staff_user_id IS NOT NULL AND customer_id IS NULL)
    OR
    (party_type = 'customer' AND staff_user_id IS NULL)
  );

ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS staff_ledger_balance numeric NOT NULL DEFAULT 0;

-- Lets any signed-in tenant member list their coworkers (id + email + role)
-- to pick from when tagging a return as a staff return. Scoped to the
-- caller's own tenant only — never exposes other shops' staff.
CREATE OR REPLACE FUNCTION public.list_tenant_staff()
RETURNS TABLE(user_id uuid, email text, role text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT tm.user_id, u.email, tm.role
  FROM public.tenant_members tm
  JOIN auth.users u ON u.id = tm.user_id
  WHERE tm.tenant_id = public.current_tenant_id()
  ORDER BY u.email;
$$;

GRANT EXECUTE ON FUNCTION public.list_tenant_staff() TO authenticated;

-- Extend complete_sale_return with the staff-ledger branch. The pre-existing
-- customer/cash flow below is byte-for-byte unchanged when party_type is
-- omitted or 'customer', so no existing behaviour regresses.
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
  v_staff UUID := NULLIF(payload->>'staff_user_id','')::UUID;
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_pid UUID;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_cost NUMERIC;
  v_name TEXT;
  v_ok BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF v_party_type NOT IN ('customer','staff') THEN RAISE EXCEPTION 'Invalid party_type'; END IF;

  IF v_party_type = 'staff' THEN
    IF v_staff IS NULL THEN RAISE EXCEPTION 'staff_user_id is required for a staff return'; END IF;
    v_ok := NULL;
    SELECT true INTO v_ok FROM public.tenant_members WHERE user_id = v_staff AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Staff member does not belong to current tenant'; END IF;
    -- Staff returns never pay out cash: value is booked to the staff ledger instead.
    v_customer := NULL;
    v_refund := 0;
    v_method := 'staff_ledger';
  END IF;

  IF v_tax < 0 OR v_refund < 0 THEN RAISE EXCEPTION 'Tax/refund must be non-negative'; END IF;

  IF v_sale IS NOT NULL THEN
    SELECT true INTO v_ok FROM public.sales WHERE id = v_sale AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Sale does not belong to current tenant'; END IF;
  END IF;
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

  INSERT INTO public.sale_returns (tenant_id, sale_id, customer_id, user_id, subtotal, tax, total, refund_amount, refund_method, note, party_type, staff_user_id)
  VALUES (v_tenant, v_sale, v_customer, v_uid, v_subtotal, v_tax, v_total, v_refund, v_method, payload->>'note', v_party_type, v_staff)
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
    UPDATE public.tenant_members
    SET staff_ledger_balance = staff_ledger_balance + v_total
    WHERE tenant_id = v_tenant AND user_id = v_staff;
  ELSIF v_customer IS NOT NULL AND v_total > v_refund THEN
    UPDATE public.customers SET balance = balance - (v_total - v_refund) WHERE id = v_customer;
  END IF;

  RETURN v_id;
END; $function$;
