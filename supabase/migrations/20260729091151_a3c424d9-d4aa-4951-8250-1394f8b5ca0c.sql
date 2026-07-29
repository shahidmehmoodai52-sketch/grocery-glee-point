DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'product_barcodes','inventory_movements','product_batches','inventory_damages','inventory_waste',
    'assets','asset_categories','cash_accounts','cash_transactions','stock_count_sessions','stock_count_items',
    'store_settings','held_bills','cash_drawer_events','shift_tasks','shift_notes','shift_checklist',
    'shift_sessions','receipt_reprints','sale_voids','tenants'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;