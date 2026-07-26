
-- Allow admin_staff with 'library.manage' perm to manage the global library.
DROP POLICY IF EXISTS "super admin manages library" ON public.global_products;

CREATE POLICY "admins manage library"
ON public.global_products
FOR ALL
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR public.admin_has_perm(auth.uid(), 'library.manage')
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR public.admin_has_perm(auth.uid(), 'library.manage')
);

-- Widen the read policy so library managers can see pending/rejected rows too.
DROP POLICY IF EXISTS "read approved for approved shops or admin" ON public.global_products;

CREATE POLICY "library read access"
ON public.global_products
FOR SELECT
TO authenticated
USING (
  (
    status = 'approved'
    AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = current_tenant_id() AND t.library_approved = true)
    AND public.tenant_category_allowed(current_tenant_id(), category)
  )
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.admin_has_perm(auth.uid(), 'library.manage')
);
