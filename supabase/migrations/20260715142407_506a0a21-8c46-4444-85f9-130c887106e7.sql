-- 1. Restrict security_events INSERT: only via SECURITY DEFINER RPC (log_security_event).
DROP POLICY IF EXISTS "anyone can insert security events" ON public.security_events;
REVOKE INSERT ON public.security_events FROM anon, authenticated;

-- 2. Pin search_path on gen_tenant_slug.
CREATE OR REPLACE FUNCTION public.gen_tenant_slug(_seed text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
DECLARE
  v_base text;
  v_try text;
  i int := 0;
BEGIN
  v_base := lower(regexp_replace(coalesce(_seed, ''), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  IF v_base = '' OR length(v_base) < 3 THEN
    v_base := 'shop-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  END IF;
  v_base := substr(v_base, 1, 20);
  v_try := v_base;
  LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_try);
    i := i + 1;
    v_try := v_base || '-' || lower(substr(md5(random()::text || i::text), 1, 4));
    IF i > 20 THEN
      v_try := 'shop-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
      EXIT;
    END IF;
  END LOOP;
  RETURN v_try;
END $function$;