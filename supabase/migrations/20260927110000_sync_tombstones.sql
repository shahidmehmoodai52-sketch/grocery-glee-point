-- Offline mirror: propagate hard DELETEs.
--
-- sync.ts pulls each table incrementally by a watermark (updated_at /
-- created_at), which can add and update rows but can never notice a row
-- that was deleted server-side: it simply stops coming back. Only the two
-- catalogue tables had a (full id-list) prune pass. So a deleted sale,
-- purchase, return, ledger payment, cash entry, expense, customer, held bill
-- ... stayed in every device's offline copy forever and kept showing up in
-- offline views, ledgers and totals.
--
-- Tombstones: an AFTER DELETE (statement-level, transition table) trigger
-- records (tenant_id, table_name, row_id) for every deleted row. Devices pull
-- new tombstones by id (bigint identity, so the watermark is a simple "id >
-- last seen") and delete those rows — and their line items — locally.
-- Clients can only SELECT their own shop's tombstones.

CREATE TABLE IF NOT EXISTS public.sync_tombstones (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid        NOT NULL,
  table_name  text        NOT NULL,
  row_id      uuid        NOT NULL,
  deleted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_tombstones_tenant_id ON public.sync_tombstones (tenant_id, id);

ALTER TABLE public.sync_tombstones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_tombstones_tenant_select ON public.sync_tombstones;
CREATE POLICY sync_tombstones_tenant_select ON public.sync_tombstones
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id()));
REVOKE ALL ON public.sync_tombstones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sync_tombstones TO authenticated;

CREATE OR REPLACE FUNCTION public.record_sync_tombstones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Skip rows whose shop no longer exists (whole-shop deletion): nobody is
  -- left to sync them, and it keeps admin_delete_tenant from leaving
  -- tombstones behind.
  INSERT INTO public.sync_tombstones (tenant_id, table_name, row_id)
  SELECT o.tenant_id, TG_TABLE_NAME, o.id
    FROM old_rows o
   WHERE o.tenant_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = o.tenant_id);
  RETURN NULL;
END
$function$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sales', 'purchases', 'sale_returns', 'purchase_returns',
    'party_payments', 'cash_transactions', 'expenses',
    'customers', 'suppliers', 'held_bills',
    'inventory_damages', 'inventory_waste', 'product_batches', 'assets'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_tombstones ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_sync_tombstones AFTER DELETE ON public.%I
         REFERENCING OLD TABLE AS old_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.record_sync_tombstones()', t);
  END LOOP;
END $$;

-- A deleted shop's tombstones go with it.
CREATE OR REPLACE FUNCTION public.purge_tenant_sync_tombstones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.sync_tombstones WHERE tenant_id = OLD.id;
  RETURN OLD;
END
$function$;
DROP TRIGGER IF EXISTS trg_purge_tenant_sync_tombstones ON public.tenants;
CREATE TRIGGER trg_purge_tenant_sync_tombstones AFTER DELETE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.purge_tenant_sync_tombstones();

-- Backfill: deletes that already happened and are in the audit trail, so
-- devices also clean up rows deleted before this migration. Only ids that
-- are really gone — a tombstone for a row that still exists would make
-- devices drop a live row the incremental pull would never bring back.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sales', 'purchases', 'sale_returns', 'purchase_returns',
    'party_payments', 'cash_transactions', 'expenses',
    'customers', 'suppliers', 'held_bills',
    'inventory_damages', 'inventory_waste', 'product_batches', 'assets'
  ] LOOP
    EXECUTE format($q$
      INSERT INTO public.sync_tombstones (tenant_id, table_name, row_id, deleted_at)
      SELECT a.tenant_id, %1$L, a.record_id::uuid, max(a.created_at)
        FROM public.audit_logs a
       WHERE a.action = 'DELETE' AND a.table_name = %1$L
         AND a.tenant_id IS NOT NULL AND a.record_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.tenants tn WHERE tn.id = a.tenant_id)
         AND NOT EXISTS (SELECT 1 FROM public.%1$I x WHERE x.id = a.record_id::uuid)
         AND NOT EXISTS (SELECT 1 FROM public.sync_tombstones s
                          WHERE s.table_name = %1$L AND s.row_id = a.record_id::uuid)
       GROUP BY a.tenant_id, a.record_id
       ORDER BY max(a.created_at)$q$, t);
  END LOOP;
END $$;
