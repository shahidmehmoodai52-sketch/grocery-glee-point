CREATE OR REPLACE VIEW public.admin_action_log_view WITH (security_invoker=on) AS
SELECT 
    l.*,
    t.name as tenant_name
FROM public.admin_action_log l
LEFT JOIN tenants t ON l.tenant_id = t.id;

GRANT SELECT ON public.admin_action_log_view TO authenticated;
