-- Fix complete_purchase_return to handle credit/account refund methods correctly and ensure supplier balance is always updated
CREATE OR REPLACE FUNCTION public.complete_purchase_return(payload jsonb)
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
  v_purchase UUID := NULLIF(payload->>'purchase_id','')::UUID;
  v_supplier UUID := NULLIF(payload->>'supplier_id','')::UUID;
  v_method TEXT := COALESCE(payload->>'refund_method','cash');
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_pid UUID;
  v_qty NUMERIC;
  v_cost NUMERIC;
  v_name TEXT;
  v_stock NUMERIC;
  v_ok BOOLEAN;
  v_account_id UUID;
  v_inv TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF v_tax < 0 OR v_refund < 0 THEN RAISE EXCEPTION 'Tax/refund must be non-negative'; END IF;

  -- Verify purchase belongs to tenant
  IF v_purchase IS NOT NULL THEN
    SELECT true INTO v_ok FROM public.purchases WHERE id = v_purchase AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Purchase does not belong to current tenant'; END IF;
  END IF;

  -- Verify supplier belongs to tenant
  IF v_supplier IS NOT NULL THEN
    v_ok := NULL;
    SELECT true INTO v_ok FROM public.suppliers WHERE id = v_supplier AND tenant_id = v_tenant;
    IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Supplier does not belong to current tenant'; END IF;
  END IF;

  -- Validate items and calculate subtotal
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_cost := COALESCE((v_item->>'cost')::NUMERIC, 0);
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
    IF v_cost < 0 THEN RAISE EXCEPTION 'Cost must be non-negative'; END IF;
    
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    IF v_pid IS NOT NULL THEN
      SELECT stock INTO v_stock FROM public.products WHERE id = v_pid AND tenant_id = v_tenant;
      IF v_stock IS NULL THEN RAISE EXCEPTION 'Unknown product % (or wrong tenant)', v_pid; END IF;
    END IF;
    v_subtotal := v_subtotal + (v_qty * v_cost);
  END LOOP;

  v_total := v_subtotal + v_tax;
  IF v_refund > v_total THEN RAISE EXCEPTION 'Refund exceeds return total'; END IF;

  -- Insert return header
  INSERT INTO public.purchase_returns (tenant_id, purchase_id, supplier_id, user_id, subtotal, tax, total, refund_amount, refund_method, note)
  VALUES (v_tenant, v_purchase, v_supplier, v_uid, v_subtotal, v_tax, v_total, v_refund, v_method, payload->>'note')
  RETURNING id, return_no INTO v_id, v_inv;

  -- Insert items and update stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_qty := (v_item->>'qty')::NUMERIC;
    v_pid := NULLIF(v_item->>'product_id','')::UUID;
    v_cost := COALESCE((v_item->>'cost')::NUMERIC, 0);
    v_name := COALESCE(v_item->>'name', 'Item');
    
    IF v_pid IS NOT NULL THEN
      SELECT name INTO v_name FROM public.products WHERE id = v_pid;
    END IF;

    INSERT INTO public.purchase_return_items (tenant_id, return_id, product_id, name, qty, cost, line_total)
    VALUES (v_tenant, v_id, v_pid, v_name, v_qty, v_cost, v_qty * v_cost);

    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET stock = stock - v_qty, updated_at = now() WHERE id = v_pid;
    END IF;
  END LOOP;

  -- Update supplier balance
  IF v_supplier IS NOT NULL THEN
    -- A return is ALWAYS a credit to the supplier (reduces our debt)
    -- The amount to credit is the part NOT refunded in cash
    UPDATE public.suppliers 
    SET balance = balance - (v_total - v_refund), 
        updated_at = now() 
    WHERE id = v_supplier;
  END IF;

  -- Handle cash flow if there's a refund (Money coming back to shop)
  IF v_refund > 0 AND v_method <> 'credit' THEN
    -- Try to find the account_id if the method looks like an ID
    IF v_method ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        v_account_id := v_method::UUID;
    END IF;

    INSERT INTO public.cash_transactions (
      tenant_id,
      account_id,
      type,
      amount,
      category,
      description,
      purchase_return_id,
      transaction_date
    ) VALUES (
      v_tenant,
      v_account_id,
      'in', -- Money coming back to shop from supplier
      v_refund,
      'purchase_return',
      'Refund from supplier for return ' || v_inv,
      v_id,
      CURRENT_DATE
    );
  END IF;

  RETURN v_id;
END; $function$;

-- Ensure permissions
GRANT EXECUTE ON FUNCTION public.complete_purchase_return(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return(jsonb) TO service_role;