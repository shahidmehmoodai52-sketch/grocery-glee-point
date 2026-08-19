ALTER TABLE public.tenant_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_sequences FROM anon;
GRANT SELECT ON public.tenant_sequences TO authenticated;
GRANT ALL ON public.tenant_sequences TO service_role;
CREATE POLICY "tenant_sequences_select_own" ON public.tenant_sequences
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());