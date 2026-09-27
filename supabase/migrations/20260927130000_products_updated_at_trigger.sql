-- products.updated_at was only bumped by the stock-changing RPCs
-- (complete_sale, complete_purchase, returns, damage/waste, stock counts,
-- adjust_product_stock) which set it explicitly. A plain UPDATE — the
-- Products page editing price, name, barcode, category or is_active, or
-- the purchase page pushing a new sale rate — left it unchanged, so the
-- offline sync (updated_at watermark) never re-pulled that row. Only POS
-- tabs open at that moment got it via realtime; any device that was closed
-- or offline kept showing the old price/name/barcode.
--
-- Same trigger every other synced table uses. No server-side backfill: a
-- 26k-row UPDATE here would fan out as realtime events to every open POS.
-- Instead the client re-downloads products/product_barcodes once (see
-- sync.ts CATALOG_RESYNC_KEY), which also heals rows edited before this.
DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
