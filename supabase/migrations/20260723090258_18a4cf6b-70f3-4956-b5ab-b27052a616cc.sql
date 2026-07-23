
CREATE OR REPLACE FUNCTION public.my_tenant_expires_at()
RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public'
AS $$
DECLARE v_tenant uuid; v_exp timestamptz;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT expires_at INTO v_exp
    FROM public.tenant_subscriptions
   WHERE tenant_id = v_tenant
   ORDER BY started_at DESC LIMIT 1;
  RETURN v_exp;
END $$;

GRANT EXECUTE ON FUNCTION public.my_tenant_expires_at() TO authenticated;
