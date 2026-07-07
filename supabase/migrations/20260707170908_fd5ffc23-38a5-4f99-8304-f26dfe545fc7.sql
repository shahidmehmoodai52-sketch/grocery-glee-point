-- Sprint 4C Task 3: offline sync queue (additive)

CREATE TABLE IF NOT EXISTS public.sync_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE
                DEFAULT public.current_tenant_id(),
  user_id      UUID,
  entity_type  TEXT NOT NULL,
  entity_id    UUID,
  operation    TEXT NOT NULL CHECK (operation IN ('insert','update','delete','rpc')),
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','completed','failed','conflict')),
  retry_count  INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  client_uuid  UUID,                              -- idempotency key from the client
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_queue TO authenticated;
GRANT ALL ON public.sync_queue TO service_role;

-- Idempotency: same client-generated uuid can only enqueue once per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS sync_queue_client_uuid_uidx
  ON public.sync_queue (tenant_id, client_uuid) WHERE client_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS sync_queue_tenant_status_idx  ON public.sync_queue (tenant_id, status);
CREATE INDEX IF NOT EXISTS sync_queue_created_idx        ON public.sync_queue (created_at);
CREATE INDEX IF NOT EXISTS sync_queue_entity_type_idx    ON public.sync_queue (entity_type);
CREATE INDEX IF NOT EXISTS sync_queue_tenant_pending_idx ON public.sync_queue (tenant_id, created_at)
  WHERE status IN ('pending','failed');

-- Trigger: keep tenant_id + updated_at in sync
CREATE TRIGGER trg_fill_tenant_id_sync_queue
  BEFORE INSERT ON public.sync_queue
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenant_id();

CREATE TRIGGER trg_touch_sync_queue
  BEFORE UPDATE ON public.sync_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS
ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;

-- SELECT: tenant members read their tenant's queue
DROP POLICY IF EXISTS sync_queue_select_tenant ON public.sync_queue;
CREATE POLICY sync_queue_select_tenant ON public.sync_queue
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- INSERT: any authenticated user in the tenant may enqueue, but must own the row
DROP POLICY IF EXISTS sync_queue_insert_own ON public.sync_queue;
CREATE POLICY sync_queue_insert_own ON public.sync_queue
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND (user_id IS NULL OR user_id = auth.uid()));

-- UPDATE: user updates only their own rows (e.g. to mark retry); admins may update any
DROP POLICY IF EXISTS sync_queue_update_own ON public.sync_queue;
CREATE POLICY sync_queue_update_own ON public.sync_queue
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
  WITH CHECK (tenant_id = public.current_tenant_id());

-- DELETE: same rule
DROP POLICY IF EXISTS sync_queue_delete_own ON public.sync_queue;
CREATE POLICY sync_queue_delete_own ON public.sync_queue
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (user_id = auth.uid() OR public.has_role(auth.uid(),'admin')));

-- Restrictive isolation (consistent with Task 1)
DROP POLICY IF EXISTS tenant_isolation_select ON public.sync_queue;
CREATE POLICY tenant_isolation_select ON public.sync_queue
  AS RESTRICTIVE FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_insert ON public.sync_queue;
CREATE POLICY tenant_isolation_insert ON public.sync_queue
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_update ON public.sync_queue;
CREATE POLICY tenant_isolation_update ON public.sync_queue
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_delete ON public.sync_queue;
CREATE POLICY tenant_isolation_delete ON public.sync_queue
  AS RESTRICTIVE FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());