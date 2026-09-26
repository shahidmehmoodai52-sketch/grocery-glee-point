-- Offline mirror: make edits to transaction rows reach every device.
--
-- sync.ts pulls each table incrementally by a watermark column. Tables
-- without a trigger-maintained updated_at fell back to created_at, which
-- never changes on UPDATE -- so an edited sale (total/paid changed,
-- customer reassigned), an edited purchase (e.g. a supplier payment added
-- via Edit), an edited return or an edited ledger payment NEVER reached a
-- device whose mirror already had that row, and offline views showed the
-- stale version forever. Backdated purchases (created_at set to an earlier
-- date than the device's watermark at insert time) were never pulled at all.
--
-- Same approach as add_updated_at_to_customers_and_suppliers:
--   * add updated_at where missing (sales already has the column, just no
--     trigger);
--   * backfill it to created_at so the switch of watermark column from
--     created_at -> updated_at is continuous for existing devices (no full
--     re-download);
--   * then bump updated_at = now() once for rows whose audit trail shows a
--     change after creation (edited or backdated), so every device re-pulls
--     exactly those rows one time and heals its stale copies;
--   * a BEFORE UPDATE trigger (touch_updated_at) keeps it current.
--
-- The backfill UPDATEs run with the audit triggers disabled so they don't
-- write thousands of meaningless audit_logs rows, and with sales'
-- trg_staff_purchase_rules disabled so re-touching an old row can't
-- silently rewrite its paid/status/customer_id. Only updated_at changes.

-- 1. Columns (sales already has one) -----------------------------------------
ALTER TABLE public.purchases        ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.sale_returns     ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.party_payments   ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- 2. Backfill (audit / rule triggers off for the duration) ------------------
ALTER TABLE public.sales            DISABLE TRIGGER trg_audit_sales;
ALTER TABLE public.sales            DISABLE TRIGGER trg_staff_purchase_rules;
ALTER TABLE public.purchases        DISABLE TRIGGER trg_audit_purchases;
ALTER TABLE public.party_payments   DISABLE TRIGGER trg_audit_party_payments;

-- sales.updated_at was DEFAULT now() at insert: already ~created_at for rows
-- synced online. Leave it, only heal the edited ones below.
UPDATE public.purchases        SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE public.sale_returns     SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE public.purchase_returns SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE public.party_payments   SET updated_at = created_at WHERE updated_at IS NULL;

-- One-time heal: rows changed (or inserted backdated) after created_at.
WITH last_evt AS (
  SELECT table_name, record_id::text AS rid, max(created_at) AS mx
  FROM public.audit_logs
  WHERE table_name IN ('sales','purchases','sale_returns','purchase_returns','party_payments')
    AND action IN ('INSERT','UPDATE','EDIT_SALE')
  GROUP BY 1, 2
)
UPDATE public.sales t SET updated_at = now()
  FROM last_evt l WHERE l.table_name = 'sales' AND l.rid = t.id::text AND l.mx > t.created_at + interval '1 minute';

WITH last_evt AS (
  SELECT record_id::text AS rid, max(created_at) AS mx FROM public.audit_logs
  WHERE table_name = 'purchases' AND action IN ('INSERT','UPDATE') GROUP BY 1
)
UPDATE public.purchases t SET updated_at = now()
  FROM last_evt l WHERE l.rid = t.id::text AND l.mx > t.created_at + interval '1 minute';

WITH last_evt AS (
  SELECT record_id::text AS rid, max(created_at) AS mx FROM public.audit_logs
  WHERE table_name = 'sale_returns' AND action IN ('INSERT','UPDATE') GROUP BY 1
)
UPDATE public.sale_returns t SET updated_at = now()
  FROM last_evt l WHERE l.rid = t.id::text AND l.mx > t.created_at + interval '1 minute';

WITH last_evt AS (
  SELECT record_id::text AS rid, max(created_at) AS mx FROM public.audit_logs
  WHERE table_name = 'purchase_returns' AND action IN ('INSERT','UPDATE') GROUP BY 1
)
UPDATE public.purchase_returns t SET updated_at = now()
  FROM last_evt l WHERE l.rid = t.id::text AND l.mx > t.created_at + interval '1 minute';

WITH last_evt AS (
  SELECT record_id::text AS rid, max(created_at) AS mx FROM public.audit_logs
  WHERE table_name = 'party_payments' AND action IN ('INSERT','UPDATE') GROUP BY 1
)
UPDATE public.party_payments t SET updated_at = now()
  FROM last_evt l WHERE l.rid = t.id::text AND l.mx > t.created_at + interval '1 minute';

ALTER TABLE public.sales            ENABLE TRIGGER trg_audit_sales;
ALTER TABLE public.sales            ENABLE TRIGGER trg_staff_purchase_rules;
ALTER TABLE public.purchases        ENABLE TRIGGER trg_audit_purchases;
ALTER TABLE public.party_payments   ENABLE TRIGGER trg_audit_party_payments;

-- 3. Defaults / NOT NULL -----------------------------------------------------
ALTER TABLE public.purchases        ALTER COLUMN updated_at SET DEFAULT now(), ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.sale_returns     ALTER COLUMN updated_at SET DEFAULT now(), ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.purchase_returns ALTER COLUMN updated_at SET DEFAULT now(), ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.party_payments   ALTER COLUMN updated_at SET DEFAULT now(), ALTER COLUMN updated_at SET NOT NULL;

-- 4. Keep it current on every UPDATE -----------------------------------------
DROP TRIGGER IF EXISTS trg_sales_updated_at ON public.sales;
CREATE TRIGGER trg_sales_updated_at BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_purchases_updated_at ON public.purchases;
CREATE TRIGGER trg_purchases_updated_at BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_sale_returns_updated_at ON public.sale_returns;
CREATE TRIGGER trg_sale_returns_updated_at BEFORE UPDATE ON public.sale_returns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_purchase_returns_updated_at ON public.purchase_returns;
CREATE TRIGGER trg_purchase_returns_updated_at BEFORE UPDATE ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_party_payments_updated_at ON public.party_payments;
CREATE TRIGGER trg_party_payments_updated_at BEFORE UPDATE ON public.party_payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5. Index for the incremental pull (ORDER BY updated_at, id; RLS by tenant)
CREATE INDEX IF NOT EXISTS idx_sales_tenant_updated_at            ON public.sales            (tenant_id, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_purchases_tenant_updated_at        ON public.purchases        (tenant_id, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_tenant_updated_at     ON public.sale_returns     (tenant_id, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_tenant_updated_at ON public.purchase_returns (tenant_id, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_party_payments_tenant_updated_at   ON public.party_payments   (tenant_id, updated_at, id);
