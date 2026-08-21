-- Create admin_action_log table
CREATE TABLE public.admin_action_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid REFERENCES auth.users(id),
    action text NOT NULL,
    tenant_id uuid REFERENCES tenants(id),
    entity_type text,
    entity_id text,
    reason text,
    before_state jsonb,
    after_state jsonb,
    metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Grant access
GRANT SELECT ON public.admin_action_log TO authenticated;
GRANT ALL ON public.admin_action_log TO service_role;

-- Enable RLS
ALTER TABLE public.admin_action_log ENABLE ROW LEVEL SECURITY;

-- Policy: Admin staff can view logs
CREATE POLICY "admin_staff_view_action_log" ON public.admin_action_log
    FOR SELECT TO authenticated
    USING (public.am_i_admin_staff());

-- Audit function
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
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.admin_action_log (
        actor_id, action, tenant_id, entity_type, entity_id, reason, before_state, after_state, metadata
    ) VALUES (
        auth.uid(), _action, _tenant_id, _entity_type, _entity_id, _reason, _before_state, _after_state, _metadata
    );
END;
$$;

-- Update admin_set_tenant_status to log action
CREATE OR REPLACE FUNCTION public.admin_set_tenant_status(
  _tenant_id uuid,
  _status text,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_status text;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.approve') AND NOT public.admin_has_perm(auth.uid(), 'shops.suspend') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT status INTO _old_status FROM public.tenants WHERE id = _tenant_id;

  UPDATE public.tenants
  SET status = _status,
      updated_at = now()
  WHERE id = _tenant_id;

  PERFORM public.log_admin_action(
    'TENANT_SET_STATUS',
    _tenant_id,
    'tenant',
    _tenant_id::text,
    _reason,
    jsonb_build_object('status', _old_status),
    jsonb_build_object('status', _status)
  );
END;
$$;

-- Update admin_set_tenant_plan to log action
CREATE OR REPLACE FUNCTION public.admin_set_tenant_plan(
  _tenant_id uuid,
  _plan text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_plan text;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.manage') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT plan INTO _old_plan FROM public.tenants WHERE id = _tenant_id;

  UPDATE public.tenants
  SET plan = _plan,
      updated_at = now()
  WHERE id = _tenant_id;

  PERFORM public.log_admin_action(
    'TENANT_SET_PLAN',
    _tenant_id,
    'tenant',
    _tenant_id::text,
    NULL,
    jsonb_build_object('plan', _old_plan),
    jsonb_build_object('plan', _plan)
  );
END;
$$;
