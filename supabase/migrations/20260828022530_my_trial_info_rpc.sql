-- Lets the client show a "N days left in your trial" banner without needing
-- to resolve the current tenant id itself (mirrors my_tenant_status()).
CREATE OR REPLACE FUNCTION public.my_trial_info()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_sub record;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RETURN NULL; END IF;

  SELECT status, expires_at INTO v_sub
    FROM public.tenant_subscriptions
   WHERE tenant_id = v_tenant
   ORDER BY started_at DESC
   LIMIT 1;

  IF v_sub.status IS NULL OR v_sub.status <> 'trialing' THEN RETURN NULL; END IF;

  RETURN jsonb_build_object('status', v_sub.status, 'expires_at', v_sub.expires_at);
END $function$;
