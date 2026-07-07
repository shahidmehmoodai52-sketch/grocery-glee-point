
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_claim text;
  v_guc text;
  v_uid uuid := auth.uid();
  v_tid uuid;
  v_count int;
BEGIN
  BEGIN
    v_claim := (current_setting('request.jwt.claims', true)::jsonb
                 -> 'app_metadata' ->> 'tenant_id');
    IF v_claim IS NOT NULL AND v_claim <> '' THEN
      RETURN v_claim::uuid;
    END IF;
  EXCEPTION WHEN others THEN NULL; END;

  BEGIN
    v_guc := current_setting('app.current_tenant_id', true);
    IF v_guc IS NOT NULL AND v_guc <> '' THEN
      RETURN v_guc::uuid;
    END IF;
  EXCEPTION WHEN others THEN NULL; END;

  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_count
    FROM public.tenant_members WHERE user_id = v_uid;

  IF v_count = 1 THEN
    SELECT tenant_id INTO v_tid
      FROM public.tenant_members WHERE user_id = v_uid LIMIT 1;
    RETURN v_tid;
  END IF;

  RETURN NULL;
END $function$;
