-- Mirror image of 20260911100500_pharmacy_sale_return_batch_restock.sql's
-- bug fix, found while checking whether pharmacy work was complete:
-- complete_purchase_return() has always decremented products.stock but
-- never touched product_batches, exactly like sale returns didn't touch it
-- before that fix. For a track_batches=true product, returning purchased
-- stock to the supplier silently desyncs sum(product_batches.qty_remaining)
-- from products.stock in the other direction now -- the batch stays
-- inflated forever, showing more remaining stock (and a later expiry
-- picture) than actually exists. Grocery tenants never hit this since they
-- don't use track_batches.
--
-- Unlike the sale-return fix, a purchase return usually IS linked to the
-- original purchase (purchase_id), and product_batches already has a
-- purchase_id column recording which batch a given purchase created -- so
-- this can target the *exact* batch instead of guessing. Falls back to the
-- same "nearest to expiring active batch" heuristic as
-- restock_batch_fefo/trg_sale_return_item_restock only when the return
-- isn't linked to a purchase, or no batch matches it.
--
-- Verified on tillix-migration-test: purchase qty=10 for a track_batches
-- product (batch A created, purchase_id set, qty_remaining=10) -> purchase
-- return qty=3 against that same purchase_id -> batch A qty_remaining=7,
-- products.stock=7, matching exactly. A second scenario with no
-- purchase_id on the return correctly fell back to the nearest-expiry
-- active batch. A grocery-shaped product (track_batches=false) round-
-- tripped through the same RPC with zero product_batches rows created or
-- touched, confirming no behavior change for non-batch-tracked products.

CREATE OR REPLACE FUNCTION public.consume_batch_for_purchase_return(_product_id UUID, _qty NUMERIC, _purchase_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_batch_id UUID;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RETURN; END IF;

  SELECT tenant_id INTO v_tenant FROM public.products WHERE id = _product_id;
  IF v_tenant IS NULL THEN RETURN; END IF;

  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'User is not a member of this tenant';
  END IF;

  IF _purchase_id IS NOT NULL THEN
    SELECT id INTO v_batch_id
      FROM public.product_batches
     WHERE product_id = _product_id AND tenant_id = v_tenant AND purchase_id = _purchase_id
     ORDER BY created_at DESC
     FOR UPDATE
     LIMIT 1;
  END IF;

  IF v_batch_id IS NULL THEN
    SELECT id INTO v_batch_id
      FROM public.product_batches
     WHERE product_id = _product_id AND tenant_id = v_tenant AND status = 'active'
     ORDER BY COALESCE(expiry_date, DATE '9999-12-31') ASC, created_at ASC
     FOR UPDATE
     LIMIT 1;
  END IF;

  IF v_batch_id IS NOT NULL THEN
    UPDATE public.product_batches
       SET qty_remaining = qty_remaining - _qty, updated_at = now()
     WHERE id = v_batch_id;
  END IF;
  -- No batch at all to decrement: products.stock already reflects the
  -- return via complete_purchase_return's own UPDATE, nothing further to
  -- reconcile against.
END $$;

REVOKE ALL ON FUNCTION public.consume_batch_for_purchase_return(uuid, numeric, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consume_batch_for_purchase_return(uuid, numeric, uuid) TO authenticated;

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
  v_track_batches BOOLEAN;
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

  -- Use a small epsilon (0.01) to handle floating point rounding issues from JS
  IF v_refund > (v_total + 0.01) THEN
    RAISE EXCEPTION 'Refund exceeds return total (Refund: %, Total: %)', v_refund, v_total;
  END IF;

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
      -- Products has updated_at, keep it
      UPDATE public.products SET stock = stock - v_qty, updated_at = now() WHERE id = v_pid;

      SELECT COALESCE(track_batches, FALSE) INTO v_track_batches FROM public.products WHERE id = v_pid;
      IF v_track_batches THEN
        PERFORM public.consume_batch_for_purchase_return(v_pid, v_qty, v_purchase);
      END IF;
    END IF;
  END LOOP;

  -- Update supplier balance
  IF v_supplier IS NOT NULL THEN
    -- A return is ALWAYS a credit to the supplier (reduces our debt)
    -- The amount to credit is the part NOT refunded in cash
    -- REMOVED updated_at from suppliers as it does not exist
    UPDATE public.suppliers
    SET balance = balance - (v_total - v_refund)
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

GRANT EXECUTE ON FUNCTION public.complete_purchase_return(jsonb) TO authenticated;
