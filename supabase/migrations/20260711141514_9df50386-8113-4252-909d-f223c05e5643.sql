CREATE OR REPLACE FUNCTION public.enforce_tenant_member_guardrails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_owner_count int;
BEGIN
  IF v_actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Platform admins must be able to complete full tenant deletion. The
  -- previous rule blocked cascading deletion of the final owner member.
  IF public.is_super_admin(v_actor) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id = v_actor AND NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'You cannot change your own role';
    END IF;
    IF (NEW.role = 'owner' OR OLD.role = 'owner')
       AND NOT public.has_role(v_actor, NEW.tenant_id, 'owner'::public.tenant_role) THEN
      RAISE EXCEPTION 'Only a tenant owner can assign or remove the owner role';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'owner'
       AND EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = NEW.tenant_id)
       AND NOT public.has_role(v_actor, NEW.tenant_id, 'owner'::public.tenant_role) THEN
      RAISE EXCEPTION 'Only a tenant owner can add another owner';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' THEN
      SELECT count(*) INTO v_owner_count
        FROM public.tenant_members
        WHERE tenant_id = OLD.tenant_id AND role = 'owner';
      IF v_owner_count <= 1 THEN
        RAISE EXCEPTION 'Cannot remove the last owner of a tenant';
      END IF;
      IF NOT public.has_role(v_actor, OLD.tenant_id, 'owner'::public.tenant_role) THEN
        RAISE EXCEPTION 'Only a tenant owner can remove an owner';
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $function$;