-- Stock count (physical inventory count) never touched product_batches for
-- track_batches products -- approve_stock_count_session() only ever wrote
-- products.stock. A pharmacy shop doing a physical count would get a
-- correct total stock number, but batch qty_remaining would drift away
-- from it forever, with no way to tell which batch the discrepancy
-- actually belonged to.
--
-- Rather than inventing a new "which batch was miscounted" heuristic, this
-- reuses the two FEFO functions already used everywhere else in the
-- pharmacy batch system, on the same principle each already encodes:
--   - Found MORE stock than expected (a positive count adjustment):
--     restock_batch_fefo() -- the same function sale returns use to put
--     stock back "where it's most urgent to sell again" (nearest-expiry
--     active batch, or a new no-expiry batch if none exists).
--   - Found LESS stock than expected (a shrinkage/negative adjustment):
--     consume_batches_fefo() -- the same function sales use, which (since
--     20260912110000) already skips already-expired batches so a
--     miscounted loss is never blamed on stock that's sitting there
--     expired and unsold, not shrunk.
-- Uses the RPC's own v_delta (computed against the LIVE current stock at
-- approval time, not the stale system_qty snapshot from when the item was
-- counted) so the batch adjustment always matches the exact stock change
-- actually being applied.
--
-- To be verified on tillix-migration-test before this is trusted: a
-- track_batches product with one valid batch (qty_remaining=10, stock=10)
-- approved with actual_qty=7 -> batch reduced to 7, products.stock=7. A
-- separate track_batches product with an expired batch (qty=5) and a
-- valid batch (qty=5, stock=10), approved with actual_qty=7 (shortage of
-- 3) -> only the valid batch reduced (to 2), expired batch untouched. A
-- third track_batches product with no batches at all, approved with a
-- surplus (actual_qty above current stock) -> a new no-expiry batch
-- created for the surplus qty, matching restock_batch_fefo's existing
-- fallback. A track_batches=false (grocery-shaped) product round-tripped
-- with zero product_batches rows touched or created.

CREATE OR REPLACE FUNCTION public.approve_stock_count_session(_session_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_session public.stock_count_sessions%ROWTYPE;
  v_item RECORD;
  v_current NUMERIC;
  v_delta NUMERIC;
  v_cost NUMERIC;
  v_total_variance NUMERIC := 0;
  v_track_batches BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF NOT public.has_role(v_uid,'admin') THEN RAISE EXCEPTION 'Only an admin can approve a stock count'; END IF;

  SELECT * INTO v_session
    FROM public.stock_count_sessions
    WHERE id = _session_id AND tenant_id = v_tenant
    FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'Stock count session not found'; END IF;
  IF v_session.status = 'completed' THEN RAISE EXCEPTION 'Session already approved'; END IF;
  IF v_session.status = 'cancelled' THEN RAISE EXCEPTION 'Session was cancelled'; END IF;

  FOR v_item IN
    SELECT * FROM public.stock_count_items
      WHERE session_id = _session_id AND tenant_id = v_tenant
  LOOP
    SELECT COALESCE(stock,0), COALESCE(cost_price,0), COALESCE(track_batches, FALSE)
      INTO v_current, v_cost, v_track_batches
      FROM public.products WHERE id = v_item.product_id FOR UPDATE;
    IF v_current IS NULL THEN CONTINUE; END IF;
    v_delta := COALESCE(v_item.actual_qty,0) - v_current;
    IF v_delta = 0 THEN CONTINUE; END IF;

    UPDATE public.products
      SET stock = v_item.actual_qty, updated_at = now()
      WHERE id = v_item.product_id;

    IF v_track_batches THEN
      IF v_delta > 0 THEN
        PERFORM public.restock_batch_fefo(v_item.product_id, v_delta);
      ELSE
        PERFORM public.consume_batches_fefo(v_item.product_id, ABS(v_delta));
      END IF;
    END IF;

    INSERT INTO public.inventory_movements (
      tenant_id, product_id, movement_type, reference_type, reference_id, reference_no,
      qty_change, stock_before, stock_after, unit_cost, total_cost,
      user_id, reason, note
    ) VALUES (
      v_tenant, v_item.product_id, 'stock_count', 'stock_count',
      _session_id, 'SC-' || substr(_session_id::text, 1, 8),
      v_delta, v_current, v_item.actual_qty, v_cost,
      ROUND((v_cost * ABS(v_delta))::numeric, 4),
      v_uid, COALESCE(v_item.reason, 'Physical count adjustment'), NULL
    );

    v_total_variance := v_total_variance + (v_delta * v_cost);
  END LOOP;

  UPDATE public.stock_count_sessions
    SET status = 'completed',
        approved_by = v_uid,
        completed_at = now(),
        total_variance_value = v_total_variance
    WHERE id = _session_id;

  RETURN _session_id;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_stock_count_session(UUID) TO authenticated;
