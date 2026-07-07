
-- Replace the permissive "read all profiles" policy with a tenant-scoped one.
DROP POLICY IF EXISTS profiles_read_all_auth ON public.profiles;

-- Users may read their own profile, plus profiles of users who share
-- at least one tenant membership with them. All other rows are hidden.
CREATE POLICY profiles_read_self_or_cotenant
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.tenant_members me
      JOIN public.tenant_members other
        ON other.tenant_id = me.tenant_id
      WHERE me.user_id = auth.uid()
        AND other.user_id = public.profiles.id
    )
  );
