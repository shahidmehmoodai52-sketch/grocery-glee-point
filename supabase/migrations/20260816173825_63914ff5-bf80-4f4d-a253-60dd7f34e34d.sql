-- Fix purchase deletion logic to properly restore stock and reverse financial effects.
-- We implement a SECURITY DEFINER function to handle this safely in a single transaction.

CREATE OR REPLACE FUNCTION public.delete_purchase_v2(_purchase_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p RECORD;
  v_item RECORD;
  v_tenant UUID := public.current_tenant_id();
  v_uid UUID := auth.uid();
  v_balance_to_reverse NUMERIC;
BEGIN
  -- 1. Authorization check
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  
  -- Verify ownership and get purchase details
  SELECT * INTO v_p 
  FROM public.purchases 
  WHERE id = _purchase_id AND tenant_id = v_tenant
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found or access denied';
  END IF;

  -- 2. Reverse stock changes
  PERFORM set_config('app.stock_change_source', 'undo_purchase', true);

  FOR v_item IN 
    SELECT product_id, qty 
    FROM public.purchase_items 
    WHERE purchase_id = _purchase_id
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      UPDATE public.products 
      SET stock = stock - COALESCE(v_item.qty, 0),
          updated_at = now()
      WHERE id = v_item.product_id;
      
      -- Record inventory movement (negative of the purchase)
      PERFORM public.record_inventory_movement(
        v_tenant, v_item.product_id, 'adjustment', 'purchase',
        _purchase_id, v_p.invoice_no,
        -COALESCE(v_item.qty, 0), NULL,
        v_uid, NULL, v_p.supplier_id,
        'Purchase deleted: ' || COALESCE(v_p.invoice_no, ''), NULL
      );
    END IF;
  END LOOP;

  -- 3. Reverse Supplier Balance
  v_balance_to_reverse := v_p.total - v_p.paid;
  IF v_balance_to_reverse > 0 AND v_p.supplier_id IS NOT NULL THEN
    UPDATE public.suppliers 
    SET balance = balance - v_balance_to_reverse 
    WHERE id = v_p.supplier_id;
  END IF;

  -- 4. Delete related Cash Transactions
  DELETE FROM public.cash_transactions 
  WHERE tenant_id = v_tenant 
    AND (
      reference = 'Purchase ' || v_p.invoice_no
      OR (category = 'purchase' AND reference = v_p.invoice_no)
    );

  -- 5. Delete the purchase (items will cascade delete)
  DELETE FROM public.purchases WHERE id = _purchase_id;
  
  PERFORM set_config('app.stock_change_source', '', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_purchase_v2(UUID) TO authenticated;
