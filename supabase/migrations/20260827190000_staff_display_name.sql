-- Staff members previously had no stored display name — only their login
-- email, which is often a technical-looking address (e.g.
-- shahid@shop-default-shop.local). Add a name field so returns/ledgers can
-- show a real person's name instead. Applied live via Lovable Cloud MCP on
-- 2026-08-27; kept here so the migration history matches production.

ALTER TABLE public.tenant_members ADD COLUMN IF NOT EXISTS display_name text;

DROP FUNCTION IF EXISTS public.list_tenant_staff();

CREATE FUNCTION public.list_tenant_staff()
RETURNS TABLE(user_id uuid, email text, role text, display_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT tm.user_id, u.email, tm.role, tm.display_name
  FROM public.tenant_members tm
  JOIN auth.users u ON u.id = tm.user_id
  WHERE tm.tenant_id = public.current_tenant_id()
  ORDER BY COALESCE(tm.display_name, u.email);
$$;

GRANT EXECUTE ON FUNCTION public.list_tenant_staff() TO authenticated;
