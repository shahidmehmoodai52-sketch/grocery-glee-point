-- Reconcile admin_action_log / admin_action_log_view / log_admin_action with
-- what has been live in production since before this migration history began.
-- Confirmed via direct introspection against both Lovable Cloud production
-- and the Supabase migration-target project: the table, view, function and
-- an RLS policy already exist identically on both, but were never captured
-- in a tracked migration. This file is a no-op reconciliation wherever they
-- already exist, and a real create on a fresh environment (e.g. a new
-- Supabase branch that only replays tracked migrations).

CREATE TABLE IF NOT EXISTS public.admin_action_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid REFERENCES auth.users(id),
  action       text NOT NULL,
  tenant_id    uuid REFERENCES public.tenants(id),
  entity_type  text,
  entity_id    text,
  reason       text,
  before_state jsonb,
  after_state  jsonb,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Fix: the live tenant_id FK has no ON DELETE action (defaults to NO ACTION),
-- which blocks admin_delete_tenant's own log_admin_action('TENANT_DELETE', ...)
-- call from ever letting the tenant row actually be deleted afterwards --
-- every tenant deletion attempt fails at that final step, since a freshly
-- inserted admin_action_log row now references the very tenant being
-- deleted. Align the FK with the column's own (already nullable) design so
-- the delete can proceed and the log row survives with tenant_id set NULL.
ALTER TABLE public.admin_action_log
  DROP CONSTRAINT IF EXISTS admin_action_log_tenant_id_fkey;
ALTER TABLE public.admin_action_log
  ADD CONSTRAINT admin_action_log_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;

GRANT SELECT ON public.admin_action_log TO authenticated;

CREATE OR REPLACE FUNCTION public.log_admin_action(
  _action text,
  _tenant_id uuid DEFAULT NULL,
  _entity_type text DEFAULT NULL,
  _entity_id text DEFAULT NULL,
  _reason text DEFAULT NULL,
  _before_state jsonb DEFAULT NULL,
  _after_state jsonb DEFAULT NULL,
  _metadata jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    INSERT INTO public.admin_action_log (
        actor_id, action, tenant_id, entity_type, entity_id, reason, before_state, after_state, metadata
    ) VALUES (
        auth.uid(), _action, _tenant_id, _entity_type, _entity_id, _reason, _before_state, _after_state, _metadata
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.log_admin_action(text, uuid, text, text, text, jsonb, jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.log_admin_action(text, uuid, text, text, text, jsonb, jsonb, jsonb) TO authenticated;

-- security_invoker = true is critical here: without it, this view (owned by
-- the postgres role, which has BYPASSRLS) would evaluate the underlying
-- table's RLS policy as postgres instead of as the querying user, silently
-- bypassing admin_staff_view_action_log for every reader -- confirmed via
-- get_advisors as an ERROR-severity "Security Definer View" finding, and
-- confirmed live on production (same view, same missing option) as an
-- actually-exploitable gap: any authenticated user, not just admin staff,
-- could read the full cross-tenant admin action log via this view.
CREATE OR REPLACE VIEW public.admin_action_log_view WITH (security_invoker = true) AS
 SELECT l.id,
    l.actor_id,
    l.action,
    l.tenant_id,
    l.entity_type,
    l.entity_id,
    l.reason,
    l.before_state,
    l.after_state,
    l.metadata,
    l.created_at,
    t.name AS tenant_name
   FROM public.admin_action_log l
     LEFT JOIN public.tenants t ON l.tenant_id = t.id;

GRANT SELECT ON public.admin_action_log_view TO authenticated;

ALTER TABLE public.admin_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_staff_view_action_log ON public.admin_action_log;
CREATE POLICY admin_staff_view_action_log ON public.admin_action_log
  FOR SELECT TO authenticated
  USING (public.am_i_admin_staff());

-- No INSERT/UPDATE/DELETE policies: writes only via the SECURITY DEFINER
-- log_admin_action() function, matching the audit_logs table's convention.
