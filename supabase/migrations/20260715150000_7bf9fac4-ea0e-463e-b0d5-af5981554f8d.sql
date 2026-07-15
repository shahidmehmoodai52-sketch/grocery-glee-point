
-- Sequence that produces the next shop registration number, starting after the existing 12 rows
CREATE SEQUENCE IF NOT EXISTS public.tenant_code_seq START WITH 13 INCREMENT BY 1;
GRANT USAGE, SELECT ON SEQUENCE public.tenant_code_seq TO authenticated, service_role;

-- Rewrite the slug generator to always append a zero-padded sequential number
CREATE OR REPLACE FUNCTION public.gen_tenant_slug(_seed text)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_base text;
  v_num  bigint;
  v_try  text;
  i int := 0;
BEGIN
  v_base := lower(regexp_replace(coalesce(_seed, ''), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  IF v_base = '' OR length(v_base) < 2 THEN
    v_base := 'shop';
  END IF;
  v_base := substr(v_base, 1, 20);

  LOOP
    v_num := nextval('public.tenant_code_seq');
    v_try := v_base || '-' || lpad(v_num::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_try);
    i := i + 1;
    IF i > 50 THEN
      v_try := v_base || '-' || lpad(v_num::text, 3, '0') || '-' || lower(substr(md5(random()::text), 1, 4));
      EXIT;
    END IF;
  END LOOP;

  RETURN v_try;
END $function$;
