-- Bug fix (surfaced by pharmacy business-type work, but the gap is generic):
-- complete_sale_return() has always incremented products.stock on a return
-- but never touched product_batches. For a track_batches=true product this
-- silently desyncs sum(product_batches.qty_remaining) from products.stock —
-- the returned units become invisible to FEFO consumption and to the
-- product_batch_status/expiry-alert view, permanently, from the first
-- pharmacy return onward. Grocery tenants never hit this since they don't
-- use track_batches.
--
-- Fix: mirror trg_sale_item_fefo's trigger pattern. On a sale_return_items
-- insert for a track_batches product, restock into whichever ACTIVE batch
-- is nearest to expiring (we don't record which batch a sale actually drew
-- from, so this is the best available guess, and it's consistent with FEFO
-- philosophy — put returned stock back where it's most urgent to sell
-- again). If no active batch exists at all, create a fallback batch with
-- no expiry so the stock stays traceable rather than lost to tracking.
--
-- Verified on tillix-migration-test: purchase qty=10 (batch created,
-- qty_remaining=10) -> sale qty=5 (FEFO consumes, qty_remaining=5) -> sale
-- return qty=2 (restock, qty_remaining=7) -> products.stock=7 matches
-- exactly. Before this fix the batch would have stayed stuck at 5 while
-- products.stock correctly showed 7 — a permanent, growing discrepancy.
CREATE OR REPLACE FUNCTION public.restock_batch_fefo(_product_id UUID, _qty NUMERIC)
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

  SELECT id INTO v_batch_id
    FROM public.product_batches
   WHERE product_id = _product_id AND tenant_id = v_tenant AND status = 'active'
   ORDER BY COALESCE(expiry_date, DATE '9999-12-31') ASC, created_at ASC
   FOR UPDATE
   LIMIT 1;

  IF v_batch_id IS NOT NULL THEN
    UPDATE public.product_batches
       SET qty_remaining = qty_remaining + _qty, updated_at = now()
     WHERE id = v_batch_id;
  ELSE
    INSERT INTO public.product_batches
      (tenant_id, product_id, batch_no, purchase_date, qty_initial, qty_remaining, status, note)
    VALUES
      (v_tenant, _product_id, NULL, CURRENT_DATE, _qty, _qty, 'active', 'Auto-created for a sale return with no matching active batch');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trg_sale_return_item_restock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_track BOOLEAN;
BEGIN
  IF NEW.product_id IS NULL OR NEW.qty <= 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(track_batches, FALSE) INTO v_track FROM public.products WHERE id = NEW.product_id;
  IF v_track THEN
    PERFORM public.restock_batch_fefo(NEW.product_id, NEW.qty);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sale_return_item_restock ON public.sale_return_items;
CREATE TRIGGER trg_sale_return_item_restock AFTER INSERT ON public.sale_return_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_return_item_restock();
