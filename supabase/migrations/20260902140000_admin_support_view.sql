-- Phase B: Read-only Support View ("View Shop").
--
-- This is deliberately NOT impersonation. The admin's own identity never
-- changes and no session claim is spoofed -- a prior migration
-- (20260828031919_cross_tenant_isolation_fixes.sql) explicitly removed the
-- exact mechanism ("if anything ever set current_tenant_id() for an admin,
-- it would grant instant impersonation of any tenant") that a naive
-- impersonation feature would need, and this feature does not reintroduce
-- it. The support-view frontend route instead calls the SAME already
-- read-only, already admin_has_perm('shops.view')-gated RPCs the tenant
-- detail page already uses (admin_tenant_detail, admin_shop_analytics,
-- admin_tenant_audit). This table and its two RPCs are an audit/UX layer
-- around that existing read-only access -- who looked at which tenant, why,
-- and for how long -- not a new data-access gate. A bug here cannot grant
-- an admin any access they didn't already have.

CREATE TABLE IF NOT EXISTS public.admin_support_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid NOT NULL REFERENCES auth.users(id),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reason       text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ended_at     timestamptz,
  ended_reason text
);

CREATE INDEX IF NOT EXISTS admin_support_sessions_tenant_idx
  ON public.admin_support_sessions (tenant_id, started_at DESC);

ALTER TABLE public.admin_support_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_staff_view_support_sessions ON public.admin_support_sessions;
CREATE POLICY admin_staff_view_support_sessions ON public.admin_support_sessions
  FOR SELECT TO authenticated
  USING (public.am_i_admin_staff());
-- No INSERT/UPDATE/DELETE policies: writes only via the SECURITY DEFINER
-- functions below, matching admin_action_log's existing convention.

-- security_invoker = true: evaluate as the querying user (subject to the
-- RLS policy above), not as the view-owning role. Same pattern as
-- admin_action_log_view.
CREATE OR REPLACE VIEW public.admin_support_sessions_view WITH (security_invoker = true) AS
 SELECT s.id, s.admin_id, s.tenant_id, t.name AS tenant_name, s.reason,
        s.started_at, s.expires_at, s.ended_at, s.ended_reason,
        (s.ended_at IS NULL AND s.expires_at > now()) AS is_active
   FROM public.admin_support_sessions s
   LEFT JOIN public.tenants t ON t.id = s.tenant_id;

GRANT SELECT ON public.admin_support_sessions_view TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_start_support_session(_tenant_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_expires timestamptz;
  v_tenant_name text;
  v_reason text := trim(coalesce(_reason, ''));
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF length(v_reason) < 5 THEN
    RAISE EXCEPTION 'A reason (at least 5 characters) is required to enter Support View';
  END IF;

  SELECT name INTO v_tenant_name FROM public.tenants WHERE id = _tenant_id;
  IF v_tenant_name IS NULL THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  -- Fixed, non-configurable duration: keeps the session genuinely
  -- time-limited rather than admin-adjustable from the client.
  v_expires := now() + interval '30 minutes';

  INSERT INTO public.admin_support_sessions (admin_id, tenant_id, reason, expires_at)
  VALUES (auth.uid(), _tenant_id, v_reason, v_expires)
  RETURNING id INTO v_id;

  PERFORM public.log_admin_action(
    'SUPPORT_VIEW_START', _tenant_id, 'tenant', _tenant_id::text, v_reason,
    NULL, NULL, jsonb_build_object('session_id', v_id, 'expires_at', v_expires)
  );

  RETURN jsonb_build_object(
    'id', v_id, 'tenant_id', _tenant_id, 'tenant_name', v_tenant_name,
    'reason', v_reason, 'started_at', now(), 'expires_at', v_expires
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_start_support_session(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_start_support_session(uuid, text) TO authenticated;

-- Ends the caller's own session (Exit button) or, for a super admin,
-- revokes someone else's active session. Idempotent: ending an
-- already-ended session is a silent no-op rather than an error, since the
-- frontend may call this both from an explicit Exit click and from an
-- auto-expiry timer racing the same click.
CREATE OR REPLACE FUNCTION public.admin_end_support_session(_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid;
  v_tenant_id uuid;
  v_expires_at timestamptz;
  v_already_ended boolean;
  v_ended_reason text;
BEGIN
  SELECT admin_id, tenant_id, expires_at, (ended_at IS NOT NULL)
    INTO v_admin_id, v_tenant_id, v_expires_at, v_already_ended
    FROM public.admin_support_sessions WHERE id = _session_id;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Support session not found';
  END IF;
  IF v_already_ended THEN
    RETURN;
  END IF;
  IF auth.uid() <> v_admin_id AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Derive the reason server-side (never trust a client-supplied label for
  -- an audit field): a call after the session's own expiry is an auto-expiry
  -- even if it came from the owning admin's browser timer, not a deliberate
  -- exit click.
  v_ended_reason := CASE
    WHEN auth.uid() <> v_admin_id THEN 'revoked_by_super_admin'
    WHEN v_expires_at <= now() THEN 'auto_expired'
    ELSE 'manual_exit'
  END;

  UPDATE public.admin_support_sessions
    SET ended_at = now(), ended_reason = v_ended_reason
    WHERE id = _session_id;

  PERFORM public.log_admin_action(
    'SUPPORT_VIEW_END', v_tenant_id, 'tenant', v_tenant_id::text, NULL,
    NULL, NULL, jsonb_build_object('session_id', _session_id, 'ended_reason', v_ended_reason)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_end_support_session(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_end_support_session(uuid) TO authenticated;
