
CREATE OR REPLACE FUNCTION public.trg_sale_item_undo_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
BEGIN
  IF OLD.product_id IS NULL THEN RETURN OLD; END IF;
  SELECT invoice_no, cashier_id, customer_id INTO v_sale
    FROM public.sales WHERE id = OLD.sale_id;

  -- Undoing a sale returns qty back into stock
  PERFORM public.record_inventory_movement(
    OLD.tenant_id, OLD.product_id, 'undo_sale', 'undo_sale',
    OLD.sale_id, v_sale.invoice_no,
    OLD.qty, OLD.cost,
    COALESCE(auth.uid(), v_sale.cashier_id), v_sale.customer_id, NULL,
    'Undo sale', NULL
  );
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_sale_items_undo_movement ON public.sale_items;
CREATE TRIGGER trg_sale_items_undo_movement
  AFTER DELETE ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_item_undo_movement();
