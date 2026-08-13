-- Add Shahid to his main shops
INSERT INTO public.tenant_members (tenant_id, user_id, role)
SELECT '1c951f0e-0219-4c9d-9bae-f3132958342d', id, 'owner'
FROM auth.users WHERE email = 'shahidmehmoodai52@gmail.com'
ON CONFLICT DO NOTHING;

INSERT INTO public.tenant_members (tenant_id, user_id, role)
SELECT 'c2f61efc-0f42-496a-a121-dca500deefce', id, 'owner'
FROM auth.users WHERE email = 'shahidmehmoodai52@gmail.com'
ON CONFLICT DO NOTHING;

-- Grant permissions if they were missing for some reason
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_sequences TO authenticated;
