-- The platform's own super-admin account is a tenant_members "owner" on every
-- shop (for backend support access), which meant it showed up alongside real
-- staff in the "staff return" picker — e.g. shahidmehmoodai52@gmail.com
-- appearing in Hafiz Super Store & Bakers' own staff list. Exclude anyone
-- holding the super_admin role from list_tenant_staff(); only genuine shop
-- staff remain. Applied live via Lovable Cloud MCP on 2026-08-27.

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
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = tm.user_id AND ur.role = 'super_admin'
    )
  ORDER BY COALESCE(tm.display_name, u.email);
$$;

GRANT EXECUTE ON FUNCTION public.list_tenant_staff() TO authenticated;
