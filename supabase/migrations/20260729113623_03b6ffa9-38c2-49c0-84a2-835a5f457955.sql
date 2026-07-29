INSERT INTO public.subscription_plans (name, description, price_monthly, max_users, max_products, features, active)
VALUES ('Unlimited', 'Unlimited products and users', 0, NULL, NULL, '{"reports": true, "backup": true, "multi_user": true, "priority_support": true, "advanced_analytics": true}'::jsonb, true)
ON CONFLICT (name) DO UPDATE SET max_products = NULL, max_users = NULL, active = true;

UPDATE public.tenant_subscriptions ts
SET plan_id = (SELECT id FROM public.subscription_plans WHERE name = 'Unlimited')
WHERE ts.status IN ('trialing','active')
  AND EXISTS (
    SELECT 1 FROM public.subscription_plans sp
    WHERE sp.id = ts.plan_id
      AND sp.max_products IS NOT NULL
      AND sp.max_products < (SELECT COUNT(*) FROM public.products p WHERE p.tenant_id = ts.tenant_id AND COALESCE(p.is_active, TRUE))
  );