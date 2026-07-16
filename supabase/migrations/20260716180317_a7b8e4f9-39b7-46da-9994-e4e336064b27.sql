CREATE OR REPLACE FUNCTION public.shop_owner_remove_staff(_staff_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF _staff_user_id IS NULL OR _staff_user_id = v_actor THEN
    RAISE EXCEPTION 'You cannot remove yourself';
  END IF;

  SELECT id INTO v_tenant
  FROM public.tenants
  WHERE owner_id = v_actor
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Only the shop owner can manage staff';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = v_tenant AND user_id = _staff_user_id
  ) THEN
    RAISE EXCEPTION 'This user is not part of your shop';
  END IF;

  PERFORM set_config('app.bypass_role_guard', 'on', true);

  DELETE FROM public.tenant_members
   WHERE tenant_id = v_tenant
     AND user_id = _staff_user_id;

  DELETE FROM public.user_permissions
   WHERE user_id = _staff_user_id;

  DELETE FROM public.user_roles
   WHERE user_id = _staff_user_id
     AND role IN ('admin'::public.app_role, 'cashier'::public.app_role);
END;
$$;

REVOKE ALL ON FUNCTION public.shop_owner_remove_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_owner_remove_staff(uuid) TO authenticated;