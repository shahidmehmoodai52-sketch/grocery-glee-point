-- Update current_tenant_id to be more robust for multi-tenant users (like admins)
CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claim text;
  v_uid uuid := auth.uid();
  v_tid uuid;
BEGIN
  -- 1. Check JWT claim first (explicit override)
  BEGIN
    v_claim := (current_setting('request.jwt.claims', true)::jsonb
                 -> 'app_metadata' ->> 'tenant_id');
    IF v_claim IS NOT NULL AND v_claim <> '' THEN
      RETURN v_claim::uuid;
    END IF;
  EXCEPTION WHEN others THEN NULL; END;

  IF v_uid IS NULL THEN RETURN NULL; END IF;

  -- 2. Check if user is a member of any tenant. 
  -- If they are in multiple, return the most recently updated one or just the first one.
  -- This ensures users in multiple shops (like admins) have a default.
  SELECT tenant_id INTO v_tid
    FROM public.tenant_members 
    WHERE user_id = v_uid 
    ORDER BY created_at DESC 
    LIMIT 1;
    
  RETURN v_tid;
END $function$;
